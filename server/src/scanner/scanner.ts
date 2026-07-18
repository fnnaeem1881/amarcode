import fs from "node:fs";
import path from "node:path";
import type { FrameworkId, ProjectMetadata } from "@amarcode/shared";
import { db } from "../core/db.js";

/**
 * Scans a project root, detects framework/language/package-manager/database
 * and Docker/test usage from marker files, and stores it as Project Metadata.
 * Reads only manifest files — never the whole project.
 */
export function scanProject(root: string): ProjectMetadata {
  const markers: string[] = [];
  const has = (rel: string) => {
    const ok = fs.existsSync(path.join(root, rel));
    if (ok) markers.push(rel);
    return ok;
  };
  const readJson = (rel: string): any => {
    try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); } catch { return null; }
  };
  const readText = (rel: string): string => {
    try { return fs.readFileSync(path.join(root, rel), "utf8"); } catch { return ""; }
  };

  const pkg = has("package.json") ? readJson("package.json") : null;
  const composer = has("composer.json") ? readJson("composer.json") : null;
  const pubspec = has("pubspec.yaml");
  const goMod = has("go.mod");
  const cargo = has("Cargo.toml");
  const usesDocker = has("Dockerfile") || has("docker-compose.yml") || has("docker-compose.yaml");
  has("README.md"); has("README"); has(".env.example");

  const deps: Record<string, string> = {
    ...(pkg?.dependencies ?? {}),
    ...(composer?.require ?? {}),
  };
  const devDeps: Record<string, string> = { ...(pkg?.devDependencies ?? {}) };

  const framework = detectFramework({ root, pkg, composer, pubspec, goMod, cargo, has });
  const language = detectLanguage(framework, { pubspec, goMod, cargo, has });

  const meta: ProjectMetadata = {
    root,
    name: pkg?.name ?? composer?.name ?? path.basename(root),
    framework,
    language,
    packageManager: detectPackageManager({ root, pkg, composer, pubspec, goMod, cargo, has }),
    dependencies: deps,
    devDependencies: devDeps,
    database: detectDatabase(root, deps, readText),
    usesDocker,
    testFramework: detectTestFramework(deps, devDeps, composer),
    markers,
    scannedAt: new Date().toISOString(),
  };

  db()
    .prepare("INSERT INTO projects (root, metadata_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(root) DO UPDATE SET metadata_json = excluded.metadata_json, updated_at = excluded.updated_at")
    .run(root, JSON.stringify(meta), meta.scannedAt);

  return meta;
}

export function getStoredMetadata(root: string): ProjectMetadata | undefined {
  const row = db().prepare("SELECT metadata_json FROM projects WHERE root = ?").get(root) as
    | { metadata_json: string } | undefined;
  return row ? (JSON.parse(row.metadata_json) as ProjectMetadata) : undefined;
}

interface DetectCtx {
  root: string; pkg: any; composer: any; pubspec: boolean; goMod: boolean; cargo: boolean;
  has: (rel: string) => boolean;
}

function detectFramework(c: DetectCtx): FrameworkId {
  const d = { ...(c.pkg?.dependencies ?? {}), ...(c.pkg?.devDependencies ?? {}) };
  if (c.composer?.require?.["laravel/framework"]) return "laravel";
  if (c.pubspec) {
    const pub = fs.existsSync(path.join(c.root, "pubspec.yaml")) ? fs.readFileSync(path.join(c.root, "pubspec.yaml"), "utf8") : "";
    return /flutter:/.test(pub) ? (/expo|react-native/i.test(pub) ? "expo" : "flutter") : "flutter";
  }
  if (c.goMod) return "go";
  if (c.cargo) return "rust";
  if (d["next"]) return "nextjs";
  if (d["@nestjs/core"]) return "nestjs";
  if (d["expo"]) return "expo";
  if (d["vue"] || d["nuxt"]) return "vue";
  if (d["react"] || d["react-dom"]) return "react";
  if (d["express"]) return "express";
  if (c.has("deno.json") || c.has("deno.jsonc")) return "deno";
  if (c.pkg) return "node";
  if (c.has("requirements.txt") || c.has("pyproject.toml") || c.has("Pipfile")) return "python";
  if (c.has("pom.xml") || c.has("build.gradle") || c.has("build.gradle.kts")) return "java";
  if (fs.readdirSync(c.root).some((f) => f.endsWith(".csproj") || f.endsWith(".sln"))) return "dotnet";
  return "unknown";
}

function detectLanguage(fw: FrameworkId, c: Pick<DetectCtx, "pubspec" | "goMod" | "cargo" | "has">): string {
  switch (fw) {
    case "laravel": return "PHP";
    case "flutter":
    case "expo": return c.pubspec ? "Dart" : "TypeScript";
    case "go": return "Go";
    case "rust": return "Rust";
    case "python": return "Python";
    case "java": return "Java";
    case "dotnet": return "C#";
    case "react": case "nextjs": case "vue": case "nestjs": case "express": case "node": case "deno":
      return c.has("tsconfig.json") ? "TypeScript" : "JavaScript";
    default: return "Unknown";
  }
}

function detectPackageManager(c: DetectCtx): string | undefined {
  if (c.composer) return "composer";
  if (c.pubspec) return "pub";
  if (c.goMod) return "go modules";
  if (c.cargo) return "cargo";
  if (c.has("pnpm-lock.yaml")) return "pnpm";
  if (c.has("yarn.lock")) return "yarn";
  if (c.has("bun.lockb")) return "bun";
  if (c.pkg) return "npm";
  if (c.has("requirements.txt")) return "pip";
  if (c.has("pyproject.toml")) return "poetry";
  return undefined;
}

function detectDatabase(root: string, deps: Record<string, string>, readText: (r: string) => string): string | undefined {
  const keys = Object.keys(deps).join(" ").toLowerCase();
  const env = (readText(".env.example") + readText(".env")).toLowerCase();
  if (/postgres|pg|pgvector/.test(keys) || /pgsql|postgres/.test(env)) return "PostgreSQL";
  if (/mysql|mysql2|mariadb/.test(keys) || /mysql/.test(env)) return "MySQL";
  if (/mongodb|mongoose/.test(keys) || /mongo/.test(env)) return "MongoDB";
  if (/sqlite|better-sqlite3/.test(keys) || /sqlite/.test(env)) return "SQLite";
  if (/redis|ioredis/.test(keys)) return "Redis";
  return undefined;
}

function detectTestFramework(deps: Record<string, string>, dev: Record<string, string>, composer: any): string | undefined {
  const all = { ...deps, ...dev, ...(composer?.["require-dev"] ?? {}) };
  const k = Object.keys(all).join(" ").toLowerCase();
  if (/vitest/.test(k)) return "Vitest";
  if (/jest/.test(k)) return "Jest";
  if (/mocha/.test(k)) return "Mocha";
  if (/phpunit/.test(k)) return "PHPUnit";
  if (/pytest/.test(k)) return "Pytest";
  if (/@playwright/.test(k)) return "Playwright";
  return undefined;
}
