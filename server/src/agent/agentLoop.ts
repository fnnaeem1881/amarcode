import type {
  ChatMessageInput, ModelRef, ToolCall, ToolResult,
} from "@amarcode/shared";
import { router } from "../providers/router.js";
import { toolRegistry } from "../tools/registry.js";
import { ToolContext } from "../tools/context.js";
import { contextManager } from "../context/contextManager.js";
import { recordCost } from "./cost.js";

/** Events the agent loop streams out (wired to the UI over WebSocket). */
export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; call: ToolCall }
  | { type: "tool_result"; call: ToolCall; result: ToolResult }
  | { type: "tool_event"; event: { type: string; payload: unknown } }
  | { type: "approval_request"; id: string; action: string; risk: string; detail?: string }
  | { type: "iteration"; n: number }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

export interface AgentRunOptions {
  root: string;
  task: string;
  history: ChatMessageInput[];
  override?: ModelRef;
  maxIterations?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  emit: (e: AgentEvent) => void;
  /** Ask the UI for approval; resolves true/false. */
  requestApproval: (action: string, risk: string, detail?: string) => Promise<boolean>;
}

/**
 * The agentic tool-calling loop. Assembles minimal context, streams the
 * model's response, executes requested tools, feeds results back, and repeats
 * until the model stops calling tools (or the iteration budget is hit). Tool
 * failures — including build/test errors — are fed back so the model can fix
 * and retry (error recovery).
 */
export async function runAgent(opts: AgentRunOptions): Promise<string> {
  const { root, task, emit } = opts;
  const maxIterations = opts.maxIterations ?? 12;

  const ctx = await contextManager.build({
    root, task, maxTokens: opts.maxTokens ?? 16000, maxFiles: opts.maxTokens ? 8 : 5, recentMessages: [],
  });

  const fileContext = ctx.files
    .map((f) => `<file path="${f.path}"${f.truncated ? ' summarized="true"' : ""}>\n${f.content}\n</file>`)
    .join("\n\n");

  const messages: ChatMessageInput[] = [
    { role: "system", content: `${ctx.systemPrompt}\n\nRelevant project files:\n${fileContext}` },
    ...opts.history,
    { role: "user", content: task },
  ];

  const toolCtx: ToolContext = {
    root,
    requestApproval: (action, risk, detail) => opts.requestApproval(action, risk, detail),
    emit: (event) => emit({ type: "tool_event", event }),
  };

  let finalText = "";

  for (let iter = 0; iter < maxIterations; iter++) {
    if (opts.signal?.aborted) { emit({ type: "error", message: "Cancelled" }); break; }
    emit({ type: "iteration", n: iter + 1 });

    let text = "";
    const toolCalls: ToolCall[] = [];
    let usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
    let modelUsed = "";
    let providerUsed = "";

    for await (const ev of router.streamChat(
      "coding", messages,
      { tools: toolRegistry.schemas(), stream: true, temperature: 0.2, maxOutputTokens: 4000, parallelToolCalls: true },
      opts.override, opts.signal,
    )) {
      if (ev.type === "text") { text += ev.delta; emit({ type: "text", delta: ev.delta }); }
      else if (ev.type === "tool_call") toolCalls.push(ev.toolCall);
      else if (ev.type === "usage") usage = { ...usage, ...ev.usage };
      else if (ev.type === "done") { modelUsed = ev.result.model; providerUsed = ev.result.providerId; }
      else if (ev.type === "error") { emit({ type: "error", message: ev.message }); return finalText; }
    }

    if (providerUsed) recordCost(root, providerUsed, modelUsed, usage);
    finalText = text || finalText;

    if (!toolCalls.length) {
      emit({ type: "done", text: finalText });
      return finalText;
    }

    // Record the assistant turn (with its tool calls) before adding results.
    messages.push({ role: "assistant", content: text, toolCalls });

    for (const call of toolCalls) {
      if (opts.signal?.aborted) break;
      emit({ type: "tool_start", call });
      const result = await toolRegistry.execute(call.name, toolCtx, call.arguments);
      emit({ type: "tool_result", call, result });
      messages.push({
        role: "tool",
        toolCallId: call.id,
        content: truncate(result.output, 8000),
      });
    }
  }

  emit({ type: "done", text: finalText });
  return finalText;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + `\n…[truncated ${s.length - max} chars]` : s;
}
