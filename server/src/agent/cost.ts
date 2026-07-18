import { nanoid } from "nanoid";
import type { Usage } from "@amarcode/shared";
import { db } from "../core/db.js";

/**
 * Usage + cost tracking per provider/model/project. Prices are a best-effort
 * static table (USD per 1M tokens); unknown models record token counts with a
 * zero estimate so the UI can still show usage.
 */
const PRICES: Record<string, { in: number; out: number }> = {
  "gpt-5": { in: 1.25, out: 10 },
  "gpt-5-mini": { in: 0.25, out: 2 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-haiku-4-5-20251001": { in: 0.8, out: 4 },
  "gemini-2.5-pro": { in: 1.25, out: 10 },
  "gemini-2.5-flash": { in: 0.15, out: 0.6 },
};

export function estimateCost(model: string, usage: Usage): number {
  const p = PRICES[model];
  if (!p) return 0;
  const cached = usage.cachedTokens ?? 0;
  const billedInput = Math.max(0, usage.inputTokens - cached);
  return (billedInput * p.in + cached * p.in * 0.1 + usage.outputTokens * p.out) / 1_000_000;
}

export function recordCost(root: string | undefined, providerId: string, model: string, usage: Usage): void {
  const cost = estimateCost(model, usage);
  db().prepare(
    "INSERT INTO costs (id, project_root, provider_id, model, input_tokens, output_tokens, cached_tokens, estimated_cost, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(nanoid(), root ?? null, providerId, model, usage.inputTokens, usage.outputTokens, usage.cachedTokens ?? 0, cost, new Date().toISOString());
}

export interface CostSummary {
  today: number;
  month: number;
  byProvider: Record<string, number>;
  byModel: Record<string, number>;
  byProject: Record<string, number>;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
}

export function costSummary(): CostSummary {
  const rows = db().prepare("SELECT * FROM costs").all() as any[];
  const todayStr = new Date().toISOString().slice(0, 10);
  const monthStr = todayStr.slice(0, 7);
  const s: CostSummary = {
    today: 0, month: 0, byProvider: {}, byModel: {}, byProject: {},
    totalInputTokens: 0, totalOutputTokens: 0, totalCachedTokens: 0,
  };
  for (const r of rows) {
    const day = (r.created_at as string).slice(0, 10);
    if (day === todayStr) s.today += r.estimated_cost;
    if (day.slice(0, 7) === monthStr) s.month += r.estimated_cost;
    s.byProvider[r.provider_id] = (s.byProvider[r.provider_id] ?? 0) + r.estimated_cost;
    s.byModel[r.model] = (s.byModel[r.model] ?? 0) + r.estimated_cost;
    if (r.project_root) s.byProject[r.project_root] = (s.byProject[r.project_root] ?? 0) + r.estimated_cost;
    s.totalInputTokens += r.input_tokens;
    s.totalOutputTokens += r.output_tokens;
    s.totalCachedTokens += r.cached_tokens;
  }
  return s;
}
