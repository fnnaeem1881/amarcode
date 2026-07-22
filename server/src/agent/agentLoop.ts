import type {
  ChatMessageInput, ModelRef, ToolCall, ToolResult,
} from "@amarcode/shared";
import { router } from "../providers/router.js";
import { toolRegistry } from "../tools/registry.js";
import { ToolContext } from "../tools/context.js";
import { contextManager } from "../context/contextManager.js";
import { recordCost } from "./cost.js";
import { configStore } from "../providers/configStore.js";

/** Events the agent loop streams out (wired to the UI over WebSocket). */
export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; call: ToolCall }
  | { type: "tool_result"; call: ToolCall; result: ToolResult }
  | { type: "tool_event"; event: { type: string; payload: unknown } }
  | { type: "approval_request"; id: string; action: string; risk: string; detail?: string }
  | { type: "iteration"; n: number }
  | { type: "usage"; inputTokens: number; outputTokens: number; totalTokens: number }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

export interface AgentRunOptions {
  root: string;
  task: string;
  history: ChatMessageInput[];
  override?: ModelRef;
  maxIterations?: number;
  maxTokens?: number;
  /** Force lite context (repo map, no preloaded files) even for coding tasks. */
  lite?: boolean;
  /** Attached images (data URIs) for vision-capable models. */
  images?: string[];
  /** Home mode: plain assistant chat — no tools, no project context. */
  chatOnly?: boolean;
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

  // Home mode: a plain, friendly assistant chat — no tools, no project files.
  if (opts.chatOnly) {
    const messages: ChatMessageInput[] = [
      { role: "system", content: "You are AmarCode, a helpful, friendly AI assistant. Answer conversationally and concisely." },
      ...opts.history,
      { role: "user", content: task, images: opts.images },
    ];
    let text = "";
    for await (const ev of router.streamChat("coding", messages, { stream: true, temperature: 0.5, maxOutputTokens: configStore.getSetting<number>("maxOutputTokens", 2048) }, opts.override, opts.signal)) {
      if (ev.type === "text") { text += ev.delta; emit({ type: "text", delta: ev.delta }); }
      else if (ev.type === "usage") emit({ type: "usage", inputTokens: ev.usage.inputTokens, outputTokens: ev.usage.outputTokens, totalTokens: ev.usage.inputTokens + ev.usage.outputTokens });
      else if (ev.type === "error") { emit({ type: "error", message: ev.message }); return text; }
    }
    emit({ type: "done", text });
    return text;
  }
  const maxIterations = opts.maxIterations ?? 25; // enough for multi-file tasks + verification
  // Configurable output cap. Must be large enough to write file contents, which
  // count as output tokens — a low cap truncates files. Default 4096.
  const maxOut = configStore.getSetting<number>("maxOutputTokens", 4096);

  // Token minimisation: a question doesn't need inlined files or edit/git/browser
  // tools. Use a lite context + read-only toolset; the agent reads_file on demand.
  // The Lite toggle forces the compact context but keeps full tools so it can edit.
  const coding = isCodingTask(task);
  const tools = coding ? toolRegistry.schemas() : toolRegistry.liteSchemas();
  const liteContext = opts.lite || !coding;

  const ctx = await contextManager.build({
    root, task,
    mode: liteContext ? "lite" : "full",
    maxTokens: opts.maxTokens ?? 16000,
    maxFiles: coding ? 5 : 6,
    recentMessages: [],
  });

  const fileContext = ctx.files
    .map((f) => `<file path="${f.path}"${f.truncated ? ' summarized="true"' : ""}>\n${f.content}\n</file>`)
    .join("\n\n");

  const messages: ChatMessageInput[] = [
    { role: "system", content: ctx.files.length ? `${ctx.systemPrompt}\n\nRelevant project files:\n${fileContext}` : ctx.systemPrompt },
    ...opts.history,
    { role: "user", content: task, images: opts.images },
  ];

  const toolCtx: ToolContext = {
    root,
    requestApproval: (action, risk, detail) => opts.requestApproval(action, risk, detail),
    emit: (event) => emit({ type: "tool_event", event }),
  };

  let finalText = "";
  let cumIn = 0, cumOut = 0; // cumulative token usage across iterations

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
      { tools, stream: true, temperature: 0.2, maxOutputTokens: maxOut, parallelToolCalls: true },
      opts.override, opts.signal,
    )) {
      if (ev.type === "text") { text += ev.delta; emit({ type: "text", delta: ev.delta }); }
      else if (ev.type === "tool_call") toolCalls.push(ev.toolCall);
      else if (ev.type === "usage") usage = { ...usage, ...ev.usage };
      else if (ev.type === "done") { modelUsed = ev.result.model; providerUsed = ev.result.providerId; }
      else if (ev.type === "error") { emit({ type: "error", message: ev.message }); return finalText; }
    }

    if (providerUsed) recordCost(root, providerUsed, modelUsed, usage);
    cumIn += usage.inputTokens; cumOut += usage.outputTokens;
    emit({ type: "usage", inputTokens: cumIn, outputTokens: cumOut, totalTokens: cumIn + cumOut });
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

/** Heuristic: does the task ask to change code (vs. just ask a question)? */
function isCodingTask(task: string): boolean {
  return /\b(add|create|implement|build|make|fix|bug|refactor|update|change|modify|edit|write|convert|migrate|rename|move|delete|remove|install|configure|setup|set up|integrate|generate|scaffold|optimi[sz]e|upgrade|downgrade|replace|run|test|deploy|commit|debug)\b/i.test(task);
}
