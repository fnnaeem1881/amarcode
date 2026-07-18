import type {
  ChatMessageInput,
  EmbeddingResult,
  GenerateResult,
  GenerationOptions,
  HealthCheckResult,
  ModelInfo,
  ProviderCapabilities,
  ProviderConfig,
  StreamEvent,
  ToolCall,
} from "@amarcode/shared";
import { AIProvider, estimateTokens } from "./types.js";
import { apiFetch, apiJson, STREAM_TIMEOUT_MS } from "./http.js";
import { nanoid } from "nanoid";

/** Native Ollama API for fully-local, offline operation. */
export class OllamaProvider implements AIProvider {
  constructor(readonly config: ProviderConfig) {}

  capabilities(): ProviderCapabilities {
    return {
      chat: true, streaming: true, toolCalling: true, jsonOutput: true,
      embeddings: true, listModels: true, local: true,
    };
  }

  private base(): string {
    return (this.config.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
  }

  private body(messages: ChatMessageInput[], opts: GenerationOptions, stream: boolean) {
    // Ollama defaults num_ctx to ~2048 and SILENTLY truncates larger prompts,
    // which drops the system prompt/tool instructions and breaks tool calling.
    // Size the context window to the actual prompt (+ output headroom), capped.
    const promptTokens = messages.reduce((s, m) => s + estimateTokens(m.content ?? ""), 0);
    const numCtx = Math.min(32_768, Math.max(4096, promptTokens + (opts.maxOutputTokens ?? 1024) + 1024));
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: messages.map(toOllamaMessage),
      stream,
      options: { temperature: opts.temperature, top_p: opts.topP, num_predict: opts.maxOutputTokens, num_ctx: numCtx },
    };
    if (opts.jsonMode) body.format = "json";
    if (opts.tools?.length) {
      body.tools = opts.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    return body;
  }

  async chat(messages: ChatMessageInput[], opts: GenerationOptions, signal?: AbortSignal): Promise<GenerateResult> {
    const json = await apiJson<any>(`${this.base()}/api/chat`, {
      method: "POST", body: this.body(messages, opts, false),
      providerId: this.config.id, timeoutMs: this.config.timeoutMs ?? 120_000, maxRetries: this.config.maxRetries, signal,
    });
    return {
      text: json.message?.content ?? "",
      toolCalls: parseToolCalls(json.message?.tool_calls),
      usage: { inputTokens: json.prompt_eval_count ?? 0, outputTokens: json.eval_count ?? 0 },
      model: opts.model, providerId: this.config.id,
      finishReason: json.message?.tool_calls?.length ? "tool_calls" : "stop",
    };
  }

  async *streamChat(messages: ChatMessageInput[], opts: GenerationOptions, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    // Ollama streams newline-delimited JSON (not SSE).
    const res = await apiFetch(`${this.base()}/api/chat`, {
      method: "POST", body: this.body(messages, opts, true),
      providerId: this.config.id, timeoutMs: STREAM_TIMEOUT_MS, maxRetries: 0, signal,
    });
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    const toolCalls: ToolCall[] = [];
    let usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let chunk: any;
        try { chunk = JSON.parse(line); } catch { continue; }
        if (chunk.message?.content) { text += chunk.message.content; yield { type: "text", delta: chunk.message.content }; }
        for (const tc of chunk.message?.tool_calls ?? []) {
          toolCalls.push({ id: nanoid(), name: tc.function?.name ?? "", arguments: tc.function?.arguments ?? {} });
        }
        if (chunk.done) {
          usage = { inputTokens: chunk.prompt_eval_count ?? 0, outputTokens: chunk.eval_count ?? 0, cachedTokens: 0 };
        }
      }
    }
    for (const tc of toolCalls) yield { type: "tool_call", toolCall: tc };
    yield { type: "usage", usage };
    yield {
      type: "done",
      result: { text, toolCalls, usage, model: opts.model, providerId: this.config.id, finishReason: toolCalls.length ? "tool_calls" : "stop" },
    };
  }

  async generateEmbedding(texts: string[], model: string, signal?: AbortSignal): Promise<EmbeddingResult> {
    const json = await apiJson<any>(`${this.base()}/api/embed`, {
      method: "POST", body: { model, input: texts }, providerId: this.config.id, signal,
    });
    return { vectors: json.embeddings ?? [], model, usage: { inputTokens: json.prompt_eval_count ?? 0, outputTokens: 0 } };
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const json = await apiJson<any>(`${this.base()}/api/tags`, { providerId: this.config.id, signal });
    return (json.models ?? []).map((m: any) => ({ id: m.name, providerId: this.config.id, label: m.name }));
  }

  countTokens(text: string): number { return estimateTokens(text); }

  async healthCheck(signal?: AbortSignal): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const models = await this.listModels(signal);
      return { ok: true, latencyMs: Date.now() - start, models: models.map((m) => m.id) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

function toOllamaMessage(m: ChatMessageInput): Record<string, unknown> {
  if (m.role === "tool") return { role: "tool", content: m.content };
  if (m.role === "assistant" && m.toolCalls?.length) {
    return {
      role: "assistant", content: m.content,
      tool_calls: m.toolCalls.map((tc) => ({ function: { name: tc.name, arguments: tc.arguments } })),
    };
  }
  return { role: m.role, content: m.content };
}

function parseToolCalls(raw: any[] | undefined): ToolCall[] {
  if (!raw) return [];
  return raw.map((tc) => ({ id: nanoid(), name: tc.function?.name ?? "", arguments: tc.function?.arguments ?? {} }));
}
