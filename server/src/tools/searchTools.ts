import fs from "node:fs";
import type { ToolResult } from "@amarcode/shared";
import { ToolContext } from "./context.js";
import { indexer } from "../indexer/indexer.js";
import { graph } from "../indexer/graph.js";
import { embeddingIndex } from "../context/embeddings.js";

/** Full-text search across indexed files (bounded results). */
export async function search_text(ctx: ToolContext, args: { query: string; maxResults?: number }): Promise<ToolResult> {
  const limit = args.maxResults ?? 40;
  const re = new RegExp(args.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const results: { path: string; line: number; text: string }[] = [];
  for (const entry of indexer.listEntries(ctx.root)) {
    let content: string;
    try { content = fs.readFileSync(entry.absPath, "utf8"); } catch { continue; }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        results.push({ path: entry.path, line: i + 1, text: lines[i].trim().slice(0, 200) });
        if (results.length >= limit) break;
      }
    }
    if (results.length >= limit) break;
  }
  const output = results.map((r) => `${r.path}:${r.line}: ${r.text}`).join("\n") || "No matches.";
  return { ok: true, output, data: results };
}

/** Locate a symbol's definitions via the dependency graph / index. */
export async function search_symbol(ctx: ToolContext, args: { symbol: string }): Promise<ToolResult> {
  graph.build(ctx.root);
  const defs = graph.definitions(args.symbol);
  if (!defs.length) return { ok: true, output: `No definition found for "${args.symbol}".`, data: [] };
  const output = defs.map((d) => `${d.kind} ${args.symbol} — ${d.path}:${d.line}`).join("\n");
  return { ok: true, output, data: defs };
}

/** Semantic search — retrieve the most relevant code chunks for a concept. */
export async function semantic_search(ctx: ToolContext, args: { query: string; limit?: number }): Promise<ToolResult> {
  const hits = await embeddingIndex.search(ctx.root, args.query, args.limit ?? 6);
  const output = hits.map((h) => `${h.path} (score ${h.score.toFixed(3)})\n${h.text.slice(0, 300)}`).join("\n---\n");
  return { ok: true, output: output || "No results.", data: hits };
}
