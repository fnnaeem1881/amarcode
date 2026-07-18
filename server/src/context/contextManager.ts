import fs from "node:fs";
import path from "node:path";
import type { FileIndexEntry, ProjectMetadata, StoredMessage } from "@amarcode/shared";
import { estimateTokens } from "../providers/types.js";
import { indexer } from "../indexer/indexer.js";
import { embeddingIndex } from "./embeddings.js";
import { graph } from "../indexer/graph.js";
import { getStoredMetadata } from "../scanner/scanner.js";
import { getMemory } from "../agent/memory.js";

export interface BuiltContext {
  systemPrompt: string;
  /** Files selected as relevant, with (possibly summarized) content. */
  files: { path: string; content: string; truncated: boolean }[];
  /** Estimated token cost of the assembled context. */
  tokens: number;
  selectedPaths: string[];
}

export interface ContextOptions {
  root: string;
  task: string;
  /** Total token budget for the whole prompt (context + history). */
  maxTokens?: number;
  /** Max number of files to inline. */
  maxFiles?: number;
  recentMessages?: StoredMessage[];
}

/**
 * The Context Manager. Assembles a *minimal* prompt from:
 *   project summary + memory + recent conversation + semantically-ranked files.
 * Never loads the whole project. Large files are summarized, the file set is
 * capped, and everything is fit inside an explicit token budget.
 */
export class ContextManager {
  async build(opts: ContextOptions): Promise<BuiltContext> {
    const { root, task } = opts;
    const maxTokens = opts.maxTokens ?? 16_000;
    const maxFiles = opts.maxFiles ?? 8;

    const meta = getStoredMetadata(root);
    const selected = await this.selectRelevantFiles(root, task, maxFiles);

    // Reserve budget: summary + memory + history first, files fill the rest.
    const summary = this.projectSummary(meta, root);
    const memoryBlock = this.memoryBlock(root);
    let budget = maxTokens - estimateTokens(summary) - estimateTokens(memoryBlock);

    const files: BuiltContext["files"] = [];
    for (const entry of selected) {
      if (budget <= 500) break;
      let content: string;
      try { content = fs.readFileSync(entry.absPath, "utf8"); } catch { continue; }
      const cost = estimateTokens(content);
      let truncated = false;
      if (cost > budget || cost > 4000) {
        content = summarizeFile(entry, content, Math.min(budget, 3000));
        truncated = true;
      }
      budget -= estimateTokens(content);
      files.push({ path: entry.path, content, truncated });
    }

    const systemPrompt = [summary, memoryBlock].filter(Boolean).join("\n\n");
    const tokens =
      estimateTokens(systemPrompt) + files.reduce((s, f) => s + estimateTokens(f.content), 0);

    return { systemPrompt, files, tokens, selectedPaths: files.map((f) => f.path) };
  }

  /**
   * Rank files by combining semantic similarity, importance score, dependency
   * proximity and keyword overlap — the "relevant file selection" stage.
   */
  async selectRelevantFiles(root: string, task: string, limit: number): Promise<FileIndexEntry[]> {
    const entries = indexer.listEntries(root);
    if (!entries.length) return [];
    const byPath = new Map(entries.map((e) => [e.path, e]));
    const scores = new Map<string, number>();

    // 1. Semantic search (never keyword-only).
    try {
      const hits = await embeddingIndex.search(root, task, limit * 3);
      for (const h of hits) scores.set(h.path, (scores.get(h.path) ?? 0) + h.score * 2);
    } catch { /* fall back to lexical below */ }

    // 2. Keyword / symbol-name overlap.
    const terms = task.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) ?? [];
    for (const e of entries) {
      let s = 0;
      const hay = (e.path + " " + e.symbols.map((y) => y.name).join(" ")).toLowerCase();
      for (const t of terms) if (hay.includes(t)) s += 0.3;
      if (s) scores.set(e.path, (scores.get(e.path) ?? 0) + s);
    }

    // 3. Importance prior.
    for (const e of entries) {
      if (scores.has(e.path)) scores.set(e.path, scores.get(e.path)! + e.importance * 0.5);
    }

    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);

    // 4. Pull in direct dependencies of the top file (graph proximity).
    const top = ranked.slice(0, limit);
    if (top[0]) {
      for (const dep of graph.dependencies(top[0])) {
        if (!top.includes(dep) && top.length < limit) top.push(dep);
      }
    }

    return top.map((p) => byPath.get(p)).filter((e): e is FileIndexEntry => !!e).slice(0, limit);
  }

  private projectSummary(meta: ProjectMetadata | undefined, root: string): string {
    if (!meta) return `You are working in the project at ${root}.`;
    return [
      `You are an expert software engineer working in the "${meta.name}" project.`,
      `Framework: ${meta.framework}. Language: ${meta.language}.`,
      meta.packageManager ? `Package manager: ${meta.packageManager}.` : "",
      meta.database ? `Database: ${meta.database}.` : "",
      meta.testFramework ? `Tests: ${meta.testFramework}.` : "",
      meta.usesDocker ? "This project uses Docker." : "",
      `Project root: ${meta.root}`,
      "Use tools to read and modify files. Never invent file paths — only act on files you have read.",
      "Make minimal, targeted edits. Preserve existing formatting and conventions.",
    ].filter(Boolean).join("\n");
  }

  private memoryBlock(root: string): string {
    const mem = getMemory(root);
    if (!mem) return "";
    const parts: string[] = [];
    if (mem.codingStyle) parts.push(`Coding style: ${mem.codingStyle}`);
    if (mem.architectureDecisions.length) parts.push(`Architecture decisions:\n- ${mem.architectureDecisions.join("\n- ")}`);
    if (mem.userPreferences.length) parts.push(`User preferences:\n- ${mem.userPreferences.join("\n- ")}`);
    if (mem.frameworkVersion) parts.push(`Framework version: ${mem.frameworkVersion}`);
    return parts.length ? `Project memory:\n${parts.join("\n")}` : "";
  }
}

/** Compress a large file to its structural skeleton to save tokens. */
function summarizeFile(entry: FileIndexEntry, content: string, budgetTokens: number): string {
  const header = `// [summarized: ${entry.path}] language=${entry.language} symbols=${entry.symbols.length}`;
  const outline = entry.symbols.slice(0, 60).map((s) => `${s.kind} ${s.name} @${s.line}`).join("\n");
  const head = content.split(/\r?\n/).slice(0, 40).join("\n");
  const summary = `${header}\n// Symbols:\n${outline}\n// Head:\n${head}`;
  const maxChars = budgetTokens * 4;
  return summary.length > maxChars ? summary.slice(0, maxChars) + "\n// …truncated" : summary;
}

export const contextManager = new ContextManager();

export function projectFilePath(root: string, rel: string): string {
  return path.join(root, rel);
}
