import type { ProjectMemory } from "@amarcode/shared";
import { db } from "../core/db.js";

/**
 * Persistent project memory: coding style, architecture decisions, user
 * preferences, framework/db facts. Deliberately does NOT store raw
 * conversation history — only durable facts worth recalling.
 */
export function getMemory(root: string): ProjectMemory | undefined {
  const row = db().prepare("SELECT memory_json FROM memory WHERE project_root = ?").get(root) as
    | { memory_json: string } | undefined;
  return row ? (JSON.parse(row.memory_json) as ProjectMemory) : undefined;
}

export function saveMemory(mem: ProjectMemory): void {
  mem.updatedAt = new Date().toISOString();
  db().prepare(
    "INSERT INTO memory (project_root, memory_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(project_root) DO UPDATE SET memory_json = excluded.memory_json, updated_at = excluded.updated_at",
  ).run(mem.projectRoot, JSON.stringify(mem), mem.updatedAt);
}

export function ensureMemory(root: string): ProjectMemory {
  return (
    getMemory(root) ?? {
      projectRoot: root,
      architectureDecisions: [],
      userPreferences: [],
      updatedAt: new Date().toISOString(),
    }
  );
}

export function rememberDecision(root: string, decision: string): void {
  const mem = ensureMemory(root);
  if (!mem.architectureDecisions.includes(decision)) mem.architectureDecisions.push(decision);
  saveMemory(mem);
}

export function rememberPreference(root: string, pref: string): void {
  const mem = ensureMemory(root);
  if (!mem.userPreferences.includes(pref)) mem.userPreferences.push(pref);
  saveMemory(mem);
}
