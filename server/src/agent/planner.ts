import { nanoid } from "nanoid";
import type { ChatMessageInput, ModelRef, Plan, PlanStep } from "@amarcode/shared";
import { router } from "../providers/router.js";
import { contextManager } from "../context/contextManager.js";
import { db } from "../core/db.js";

/**
 * Planner Agent. Before any edits, produces an explicit plan of which files to
 * create/modify/update — so work is deliberate and reviewable, not ad-hoc.
 */
export async function createPlan(
  sessionId: string,
  root: string,
  task: string,
  override?: ModelRef,
  signal?: AbortSignal,
): Promise<Plan> {
  const ctx = await contextManager.build({ root, task, maxTokens: 8000, maxFiles: 6 });
  const fileList = ctx.selectedPaths.map((p) => `- ${p}`).join("\n") || "(no strongly-relevant files found)";

  const messages: ChatMessageInput[] = [
    {
      role: "system",
      content:
        `${ctx.systemPrompt}\n\nYou are the planning stage. Produce a concise, ordered plan as strict JSON only.`,
    },
    {
      role: "user",
      content:
        `Task: ${task}\n\nCandidate relevant files:\n${fileList}\n\n` +
        `Return JSON: {"summary": string, "steps": [{"action": "create|modify|update|delete|run|review", "target": string, "reason": string}]}. ` +
        `Keep steps minimal and specific. No prose outside JSON.`,
    },
  ];

  const result = await router.chat("planning", messages, { jsonMode: true, temperature: 0.2, maxOutputTokens: 1500 }, override, signal);
  const parsed = safeParsePlan(result.text);

  const plan: Plan = {
    id: nanoid(),
    sessionId,
    summary: parsed.summary ?? task,
    steps: (parsed.steps ?? []).map((s): PlanStep => ({
      id: nanoid(),
      action: normalizeAction(s.action),
      target: String(s.target ?? ""),
      reason: String(s.reason ?? ""),
      status: "pending",
    })),
    createdAt: new Date().toISOString(),
  };

  db().prepare("INSERT INTO plans (id, session_id, plan_json, created_at) VALUES (?, ?, ?, ?)")
    .run(plan.id, sessionId, JSON.stringify(plan), plan.createdAt);
  return plan;
}

function safeParsePlan(text: string): { summary?: string; steps?: any[] } {
  try {
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    return JSON.parse(json);
  } catch {
    return { summary: text.slice(0, 200), steps: [] };
  }
}

function normalizeAction(a: string): PlanStep["action"] {
  const v = (a ?? "").toLowerCase();
  if (["create", "modify", "update", "delete", "run", "review"].includes(v)) return v as PlanStep["action"];
  return "modify";
}
