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
import { AIProvider, ProviderError, estimateTokens } from "./types.js";
import { apiFetch, apiJson, parseSSE } from "./http.js";
import { nanoid } from "nanoid";

/** Native Anthropic Messages API (tool use + streaming). */
export class AnthropicProvider implements AIProvider {
  constructor(readonly config: ProviderConfig) {}

  capabilities(): ProviderCapabilities {
    return {
      chat: true, streaming: true, toolCalling: true, jsonOutput: false,
      embeddings: false, listModels: true, local: false,
    };
  }

  private base(): string {
    return (this.config.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/$/, "");
  }
  private headers(): Record<string, string> {
    return {
      "x-api-key": this.config.apiKey ?? "",
      "anthropic-version": "2023-06-01",
    };
  }

  private body(messages: ChatMessageInput[], opts: GenerationOptions, stream: boolean) {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const convo = messages.filter((m) => m.role !== "system").map(toAnthropicMessage);
    const body: Record<string, unknown> = {
      model: opts.model,
      max_tokens: opts.maxOutputTokens ?? 4096,
      messages: convo,
      stream,
    };
    if (system) body.system = system;
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.topP !== undefined) body.top_p = opts.topP;
    if (opts.tools?.length) {
      body.tools = opts.tools.map((t) => ({
        name: t.name, description: t.description, input_schema: t.parameters,
      }));
    }
    return body;
  }

  async chat(messages: ChatMessageInput[], opts: GenerationOptions, signal?: AbortSignal): Promise<GenerateResult> {
    const json = await apiJson<any>(`${this.base()}/messages`, {
      method: "POST", headers: this.headers(), body: this.body(messages, opts, false),
      providerId: this.config.id, timeoutMs: this.config.timeoutMs, maxRetries: this.config.maxRetries, signal,
    });
    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const block of json.content ?? []) {
      if (block.type === "text") text += block.text;
      if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, arguments: block.input ?? {} });
    }
    return {
      text, toolCalls,
      usage: {
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
        cachedTokens: json.usage?.cache_read_input_tokens ?? 0,
      },
      model: opts.model, providerId: this.config.id,
      finishReason: json.stop_reason === "tool_use" ? "tool_calls" : json.stop_reason === "max_tokens" ? "length" : "stop",
    };
  }

  async *streamChat(messages: ChatMessageInput[], opts: GenerationOptions, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const res = await apiFetch(`${this.base()}/messages`, {
      method: "POST", headers: { ...this.headers(), accept: "text/event-stream" },
      body: this.body(messages, opts, true), providerId: this.config.id, timeoutMs: this.config.timeoutMs, maxRetries: 0, signal,
    });

    let text = "";
    const blocks = new Map<number, { type: string; id?: string; name?: string; json: string }>();
    let usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
    let finish: GenerateResult["finishReason"] = "stop";

    for await (const data of parseSSE(res)) {
      let ev: any;
      try { ev = JSON.parse(data); } catch { continue; }
      switch (ev.type) {
        case "message_start":
          usage.inputTokens = ev.message?.usage?.input_tokens ?? 0;
          usage.cachedTokens = ev.message?.usage?.cache_read_input_tokens ?? 0;
          break;
        case "content_block_start":
          blocks.set(ev.index, {
            type: ev.content_block.type, id: ev.content_block.id,
            name: ev.content_block.name, json: "",
          });
          break;
        case "content_block_delta":
          if (ev.delta.type === "text_delta") {
            text += ev.delta.text;
            yield { type: "text", delta: ev.delta.text };
          } else if (ev.delta.type === "input_json_delta") {
            const b = blocks.get(ev.index);
            if (b) b.json += ev.delta.partial_json;
          }
          break;
        case "message_delta":
          if (ev.usage?.output_tokens) usage.outputTokens = ev.usage.output_tokens;
          if (ev.delta?.stop_reason === "tool_use") finish = "tool_calls";
          else if (ev.delta?.stop_reason === "max_tokens") finish = "length";
          break;
      }
    }

    const toolCalls: ToolCall[] = [...blocks.values()]
      .filter((b) => b.type === "tool_use")
      .map((b) => ({ id: b.id ?? nanoid(), name: b.name ?? "", arguments: b.json ? safeParse(b.json) : {} }));
    for (const tc of toolCalls) yield { type: "tool_call", toolCall: tc };
    yield { type: "usage", usage };
    yield { type: "done", result: { text, toolCalls, usage, model: opts.model, providerId: this.config.id, finishReason: finish } };
  }

  async generateEmbedding(): Promise<EmbeddingResult> {
    throw new ProviderError("Anthropic does not provide an embeddings API; choose another embedding provider.", this.config.id);
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    try {
      const json = await apiJson<any>(`${this.base()}/models`, { headers: this.headers(), providerId: this.config.id, signal });
      return (json.data ?? []).map((m: any) => ({ id: m.id, providerId: this.config.id, label: m.display_name ?? m.id }));
    } catch {
      // Fall back to a static list if the models endpoint is unavailable.
      return ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5-20251001"].map((id) => ({
        id, providerId: this.config.id, label: id,
      }));
    }
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

function toAnthropicMessage(m: ChatMessageInput): Record<string, unknown> {
  if (m.role === "tool") {
    return { role: "user", content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }] };
  }
  if (m.role === "assistant" && m.toolCalls?.length) {
    const content: unknown[] = [];
    if (m.content) content.push({ type: "text", text: m.content });
    for (const tc of m.toolCalls) content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
    return { role: "assistant", content };
  }
  return { role: m.role === "assistant" ? "assistant" : "user", content: m.content };
}

function safeParse(s: string): Record<string, unknown> {
  try { return JSON.parse(s); } catch { return {}; }
}
