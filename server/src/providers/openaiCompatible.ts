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
import { apiFetch, apiJson, parseSSE, STREAM_TIMEOUT_MS } from "./http.js";
import { nanoid } from "nanoid";

/**
 * Speaks the OpenAI Chat Completions dialect. Configurable base URL makes it
 * cover OpenAI, OpenRouter, Groq, DeepSeek, Together, Fireworks, Mistral,
 * LM Studio, vLLM, Azure OpenAI and any OpenAI-compatible endpoint.
 */
export class OpenAICompatibleProvider implements AIProvider {
  constructor(readonly config: ProviderConfig) {}

  capabilities(): ProviderCapabilities {
    return {
      chat: true,
      streaming: true,
      toolCalling: true,
      jsonOutput: true,
      embeddings: true,
      listModels: true,
      local: this.config.kind === "lmstudio" || this.config.kind === "vllm",
    };
  }

  private baseUrl(): string {
    if (this.config.kind === "azure-openai" && this.config.azureEndpoint) {
      return this.config.azureEndpoint.replace(/\/$/, "");
    }
    if (this.config.baseUrl) return this.config.baseUrl.replace(/\/$/, "");
    switch (this.config.kind) {
      case "openai": return "https://api.openai.com/v1";
      case "openrouter": return "https://openrouter.ai/api/v1";
      case "groq": return "https://api.groq.com/openai/v1";
      case "deepseek": return "https://api.deepseek.com/v1";
      case "together": return "https://api.together.xyz/v1";
      case "fireworks": return "https://api.fireworks.ai/inference/v1";
      case "mistral": return "https://api.mistral.ai/v1";
      case "lmstudio": return "http://localhost:1234/v1";
      case "vllm": return "http://localhost:8000/v1";
      default: return "https://api.openai.com/v1";
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.config.kind === "azure-openai") {
      if (this.config.apiKey) h["api-key"] = this.config.apiKey;
    } else if (this.config.apiKey) {
      h["authorization"] = `Bearer ${this.config.apiKey}`;
    }
    if (this.config.organizationId) h["openai-organization"] = this.config.organizationId;
    if (this.config.kind === "openrouter") {
      if (this.config.httpReferer) h["http-referer"] = this.config.httpReferer;
      if (this.config.appName) h["x-title"] = this.config.appName;
    }
    return h;
  }

  private chatUrl(model: string): string {
    if (this.config.kind === "azure-openai") {
      const dep = this.config.azureDeployment ?? model;
      const ver = this.config.azureApiVersion ?? "2024-08-01-preview";
      return `${this.baseUrl()}/openai/deployments/${dep}/chat/completions?api-version=${ver}`;
    }
    return `${this.baseUrl()}/chat/completions`;
  }

  private body(messages: ChatMessageInput[], opts: GenerationOptions, stream: boolean) {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: messages.map(toOpenAIMessage),
      stream,
    };
    if (opts.maxOutputTokens) body.max_tokens = opts.maxOutputTokens;
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.topP !== undefined) body.top_p = opts.topP;
    if (opts.jsonMode) body.response_format = { type: "json_object" };
    if (opts.tools?.length) {
      body.tools = opts.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      if (opts.parallelToolCalls !== undefined) body.parallel_tool_calls = opts.parallelToolCalls;
    }
    if (stream) body.stream_options = { include_usage: true };
    return body;
  }

  async chat(messages: ChatMessageInput[], opts: GenerationOptions, signal?: AbortSignal): Promise<GenerateResult> {
    const json = await apiJson<any>(this.chatUrl(opts.model), {
      method: "POST",
      headers: this.headers(),
      body: this.body(messages, opts, false),
      providerId: this.config.id,
      timeoutMs: this.config.timeoutMs,
      maxRetries: this.config.maxRetries,
      signal,
    });
    const choice = json.choices?.[0];
    const msg = choice?.message ?? {};
    return {
      text: msg.content ?? "",
      toolCalls: parseToolCalls(msg.tool_calls),
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        cachedTokens: json.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      },
      model: opts.model,
      providerId: this.config.id,
      finishReason: mapFinish(choice?.finish_reason),
    };
  }

  async *streamChat(messages: ChatMessageInput[], opts: GenerationOptions, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const res = await apiFetch(this.chatUrl(opts.model), {
      method: "POST",
      headers: { ...this.headers(), accept: "text/event-stream" },
      body: this.body(messages, opts, true),
      providerId: this.config.id,
      timeoutMs: STREAM_TIMEOUT_MS,
      maxRetries: 2, // retry only happens at connect time (before body) — safe
      signal,
    });

    let text = "";
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
    let finish: GenerateResult["finishReason"] = "stop";

    for await (const data of parseSSE(res)) {
      if (data === "[DONE]") break;
      let chunk: any;
      try { chunk = JSON.parse(data); } catch { continue; }
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
          cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
        };
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (delta.content) {
        text += delta.content;
        yield { type: "text", delta: delta.content };
      }
      for (const tc of delta.tool_calls ?? []) {
        const slot = toolAcc.get(tc.index) ?? { id: tc.id ?? nanoid(), name: "", args: "" };
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name = tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
        toolAcc.set(tc.index, slot);
      }
      if (choice.finish_reason) finish = mapFinish(choice.finish_reason);
    }

    const toolCalls: ToolCall[] = [...toolAcc.values()].map((s) => ({
      id: s.id,
      name: s.name,
      arguments: safeParse(s.args),
    }));
    for (const tc of toolCalls) yield { type: "tool_call", toolCall: tc };
    yield { type: "usage", usage };
    yield {
      type: "done",
      result: { text, toolCalls, usage, model: opts.model, providerId: this.config.id, finishReason: finish },
    };
  }

  async generateEmbedding(texts: string[], model: string, signal?: AbortSignal): Promise<EmbeddingResult> {
    const url =
      this.config.kind === "azure-openai"
        ? `${this.baseUrl()}/openai/deployments/${this.config.azureDeployment ?? model}/embeddings?api-version=${this.config.azureApiVersion ?? "2024-08-01-preview"}`
        : `${this.baseUrl()}/embeddings`;
    const json = await apiJson<any>(url, {
      method: "POST",
      headers: this.headers(),
      body: { model, input: texts },
      providerId: this.config.id,
      signal,
    });
    return {
      vectors: (json.data ?? []).map((d: any) => d.embedding),
      model,
      usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: 0 },
    };
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const json = await apiJson<any>(`${this.baseUrl()}/models`, {
      headers: this.headers(),
      providerId: this.config.id,
      signal,
    });
    const items = json.data ?? json.models ?? [];
    return items.map((m: any) => ({
      id: m.id ?? m.name,
      providerId: this.config.id,
      label: m.id ?? m.name,
      contextWindow: m.context_length ?? m.context_window,
    }));
  }

  countTokens(text: string): number {
    return estimateTokens(text);
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const models = await this.listModels(signal);
      return { ok: true, latencyMs: Date.now() - start, models: models.map((m) => m.id).slice(0, 50) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

function toOpenAIMessage(m: ChatMessageInput): Record<string, unknown> {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  }
  if (m.role === "assistant" && m.toolCalls?.length) {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

function parseToolCalls(raw: any[] | undefined): ToolCall[] {
  if (!raw) return [];
  return raw.map((tc) => ({
    id: tc.id ?? nanoid(),
    name: tc.function?.name ?? "",
    arguments: safeParse(tc.function?.arguments),
  }));
}

function safeParse(s: string | undefined): Record<string, unknown> {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}

function mapFinish(reason: string | undefined): GenerateResult["finishReason"] {
  switch (reason) {
    case "length": return "length";
    case "tool_calls": return "tool_calls";
    case "content_filter": return "content_filter";
    case "stop": return "stop";
    default: return "stop";
  }
}
