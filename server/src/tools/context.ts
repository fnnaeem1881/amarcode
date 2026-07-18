import path from "node:path";
import type { ToolRisk } from "@amarcode/shared";

/** Runtime context passed to every tool execution. */
export interface ToolContext {
  root: string;
  /**
   * Approval gate for risky operations. The agent loop supplies an
   * implementation that asks the user (via the UI) and resolves true/false.
   * `dangerous` operations are always routed through this.
   */
  requestApproval(action: string, risk: ToolRisk, detail?: string): Promise<boolean>;
  /** Emit a UI event (e.g. a diff to preview, terminal output). */
  emit?(event: { type: string; payload: unknown }): void;
}

/** Resolve a project-relative path safely, refusing escapes outside the root. */
export function resolveInRoot(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  const normRoot = path.resolve(root);
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
    throw new Error(`Path escapes project root: ${rel}`);
  }
  return abs;
}

/** Patterns that must never run without explicit user confirmation. */
const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+-rf\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[a-z]*f/,
  /\bdrop\s+database\b/i,
  /\btruncate\s+table\b/i,
  /\bdocker\s+system\s+prune\b/,
  /\bdocker\s+volume\s+prune\b/,
  /\bmkfs\b/,
  /\b(shutdown|reboot|halt)\b/,
  /:\(\)\s*\{.*\};:/, // fork bomb
  /\bformat\s+[a-z]:/i,
  />\s*\/dev\/sd[a-z]/,
];

export function classifyCommandRisk(command: string): ToolRisk {
  if (DANGEROUS_PATTERNS.some((re) => re.test(command))) return "dangerous";
  if (/\b(git\s+push|npm\s+publish|rm\s+|del\s+|drop\s+|delete\s+from)\b/i.test(command)) return "confirm";
  return "safe";
}
