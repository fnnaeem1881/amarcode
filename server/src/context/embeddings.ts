import fs from "node:fs";
import type { ModelRef } from "@amarcode/shared";
import { db } from "../core/db.js";
import { indexer } from "../indexer/indexer.js";
import { router } from "../providers/router.js";
import { configStore } from "../providers/configStore.js";

/**
 * Embedding index for semantic search. Chunks source files, embeds each chunk
 * (via the configured embedding provider, or a deterministic local fallback so
 * search works fully offline), stores vectors in SQLite and ranks by cosine.
 */

const CHUNK_LINES = 60;
const CHUNK_OVERLAP = 10;

export interface SearchHit {
  path: string;
  chunk: number;
  text: string;
  score: number;
}

export class EmbeddingIndex {
  private embeddedChunks = 0;

  /** Background-friendly: embeds all indexed files in batches. */
  async embedProject(root: string, onProgress?: (done: number) => void): Promise<number> {
    const entries = indexer.listEntries(root);
    const embedRef = this.embedRef();
    let done = 0;

    for (const entry of entries) {
      if (entry.language === "Unknown" || entry.language === "JSON") continue;
      let content: string;
      try { content = fs.readFileSync(entry.absPath, "utf8"); } catch { continue; }
      const chunks = chunkText(content);
      if (!chunks.length) continue;

      const vectors = await this.embed(chunks.map((c) => c.text), embedRef);
      const insert = db().prepare(
        "INSERT INTO embeddings (root, path, chunk, text, vector) VALUES (?, ?, ?, ?, ?) ON CONFLICT(root, path, chunk) DO UPDATE SET text = excluded.text, vector = excluded.vector",
      );
      chunks.forEach((c, i) => {
        insert.run(root, entry.path, i, c.text, JSON.stringify(vectors[i]));
        this.embeddedChunks++;
      });
      done++;
      if (done % 25 === 0) onProgress?.(done);
    }
    onProgress?.(done);
    return this.embeddedChunks;
  }

  async search(root: string, query: string, limit = 8): Promise<SearchHit[]> {
    const [qVec] = await this.embed([query], this.embedRef());
    const rows = db().prepare("SELECT path, chunk, text, vector FROM embeddings WHERE root = ?").all(root) as
      { path: string; chunk: number; text: string; vector: string }[];

    const hits = rows.map((r) => ({
      path: r.path,
      chunk: r.chunk,
      text: r.text,
      score: cosine(qVec, JSON.parse(r.vector) as number[]),
    }));
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  hasEmbeddings(root: string): boolean {
    const row = db().prepare("SELECT COUNT(*) AS n FROM embeddings WHERE root = ?").get(root) as { n: number };
    return row.n > 0;
  }

  private embedRef(): ModelRef | undefined {
    return configStore.getRouting().embeddings;
  }

  private async embed(texts: string[], ref?: ModelRef): Promise<number[][]> {
    if (ref) {
      try {
        const provider = router.getProvider(ref.providerId);
        const result = await provider.generateEmbedding(texts, ref.model);
        if (result.vectors.length === texts.length) return result.vectors;
      } catch {
        // Fall through to local embedding so indexing never hard-fails.
      }
    }
    return texts.map(localEmbedding);
  }
}

function chunkText(content: string): { text: string }[] {
  const lines = content.split(/\r?\n/);
  const chunks: { text: string }[] = [];
  for (let i = 0; i < lines.length; i += CHUNK_LINES - CHUNK_OVERLAP) {
    const slice = lines.slice(i, i + CHUNK_LINES).join("\n").trim();
    if (slice) chunks.push({ text: slice });
    if (i + CHUNK_LINES >= lines.length) break;
  }
  return chunks;
}

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/**
 * Deterministic 256-dim bag-of-tokens embedding. Not as good as a real model,
 * but keeps semantic search functional with zero configuration / fully offline.
 */
function localEmbedding(text: string, dims = 256): number[] {
  const vec = new Array(dims).fill(0);
  const tokens = text.toLowerCase().match(/[a-z_][a-z0-9_]{1,}/g) ?? [];
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) { h ^= tok.charCodeAt(i); h = Math.imul(h, 16777619); }
    vec[Math.abs(h) % dims] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export const embeddingIndex = new EmbeddingIndex();
