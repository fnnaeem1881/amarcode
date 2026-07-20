import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import type { FileIndexEntry, IndexStats } from "@amarcode/shared";
import { db } from "../core/db.js";
import { walkProject } from "./walk.js";
import { languageForPath, pickParser } from "./parser.js";

/**
 * Builds and incrementally maintains the file index. Content hashing means
 * re-indexing only touches changed files. Emits progress via the callback so
 * the UI can show live indexing status without blocking.
 */
export class Indexer {
  private stats: IndexStats = emptyStats();

  getStats(): IndexStats {
    return this.stats;
  }

  /** Full (incremental) index pass over a project root. */
  async indexProject(root: string, onProgress?: (s: IndexStats) => void): Promise<IndexStats> {
    this.stats = { ...emptyStats(), status: "indexing" };
    const existing = this.loadHashes(root);
    const seen = new Set<string>();
    let totalSymbols = 0;
    let indexed = 0;
    let skipped = 0;

    const insert = db().prepare(
      "INSERT INTO files (root, path, entry_json, hash) VALUES (?, ?, ?, ?) ON CONFLICT(root, path) DO UPDATE SET entry_json = excluded.entry_json, hash = excluded.hash",
    );

    for (const file of walkProject(root)) {
      seen.add(file.relPath);
      let content: string;
      try { content = fs.readFileSync(file.absPath, "utf8"); } catch { continue; }
      const hash = crypto.createHash("sha1").update(content).digest("hex");

      if (existing.get(file.relPath) === hash) {
        skipped++;
        const prev = this.loadEntry(root, file.relPath);
        if (prev) totalSymbols += prev.symbols.length;
        continue;
      }

      const language = languageForPath(file.relPath);
      const parsed = pickParser(language).parse(content, language);
      const entry: FileIndexEntry = {
        path: file.relPath,
        absPath: file.absPath,
        language,
        size: file.size,
        hash,
        imports: parsed.imports,
        exports: parsed.exports,
        symbols: parsed.symbols,
        importance: scoreImportance(file.relPath, parsed.symbols.length),
        indexedAt: new Date().toISOString(),
      };
      insert.run(root, file.relPath, JSON.stringify(entry), hash);
      indexed++;
      totalSymbols += parsed.symbols.length;

      if ((indexed + skipped) % 200 === 0) {
        this.stats = { ...this.stats, indexedFiles: indexed, skippedFiles: skipped, totalSymbols };
        onProgress?.(this.stats);
      }
      // Yield often so parsing a large project doesn't freeze the engine.
      if ((indexed + skipped) % 40 === 0) await new Promise((r) => setImmediate(r));
    }

    // Prune entries for deleted files.
    for (const relPath of existing.keys()) {
      if (!seen.has(relPath)) db().prepare("DELETE FROM files WHERE root = ? AND path = ?").run(root, relPath);
    }

    this.stats = {
      totalFiles: seen.size,
      indexedFiles: indexed,
      skippedFiles: skipped,
      totalSymbols,
      embeddedChunks: this.stats.embeddedChunks,
      status: "ready",
    };
    onProgress?.(this.stats);
    return this.stats;
  }

  listEntries(root: string): FileIndexEntry[] {
    const rows = db().prepare("SELECT entry_json FROM files WHERE root = ?").all(root) as { entry_json: string }[];
    return rows.map((r) => JSON.parse(r.entry_json) as FileIndexEntry);
  }

  loadEntry(root: string, relPath: string): FileIndexEntry | undefined {
    const row = db().prepare("SELECT entry_json FROM files WHERE root = ? AND path = ?").get(root, relPath) as
      | { entry_json: string } | undefined;
    return row ? (JSON.parse(row.entry_json) as FileIndexEntry) : undefined;
  }

  private loadHashes(root: string): Map<string, string> {
    const rows = db().prepare("SELECT path, hash FROM files WHERE root = ?").all(root) as { path: string; hash: string }[];
    return new Map(rows.map((r) => [r.path, r.hash]));
  }

  /** Reindex a single file after an edit (keeps the index fresh incrementally). */
  reindexFile(root: string, absPath: string): FileIndexEntry | undefined {
    if (!fs.existsSync(absPath)) {
      const rel = path.relative(root, absPath).split(path.sep).join("/");
      db().prepare("DELETE FROM files WHERE root = ? AND path = ?").run(root, rel);
      return undefined;
    }
    const rel = path.relative(root, absPath).split(path.sep).join("/");
    const content = fs.readFileSync(absPath, "utf8");
    const hash = crypto.createHash("sha1").update(content).digest("hex");
    const language = languageForPath(rel);
    const parsed = pickParser(language).parse(content, language);
    const entry: FileIndexEntry = {
      path: rel, absPath, language, size: content.length, hash,
      imports: parsed.imports, exports: parsed.exports, symbols: parsed.symbols,
      importance: scoreImportance(rel, parsed.symbols.length), indexedAt: new Date().toISOString(),
    };
    db().prepare("INSERT INTO files (root, path, entry_json, hash) VALUES (?, ?, ?, ?) ON CONFLICT(root, path) DO UPDATE SET entry_json = excluded.entry_json, hash = excluded.hash")
      .run(root, rel, JSON.stringify(entry), hash);
    return entry;
  }
}

function emptyStats(): IndexStats {
  return { totalFiles: 0, indexedFiles: 0, skippedFiles: 0, totalSymbols: 0, embeddedChunks: 0, status: "idle" };
}

/** Heuristic importance: entrypoints, controllers/services and shallow paths rank higher. */
function scoreImportance(relPath: string, symbolCount: number): number {
  let score = 0.3;
  const p = relPath.toLowerCase();
  const depth = relPath.split("/").length;
  if (/(^|\/)(index|main|app|server|bootstrap|routes?)\.[a-z]+$/.test(p)) score += 0.3;
  if (/(controller|service|repository|model|handler)/.test(p)) score += 0.2;
  if (/(config|schema|migration)/.test(p)) score += 0.1;
  if (/\.(test|spec)\./.test(p)) score -= 0.2;
  score += Math.min(symbolCount / 40, 0.2);
  score -= Math.min(depth / 40, 0.15);
  return Math.max(0, Math.min(1, score));
}

export const indexer = new Indexer();
