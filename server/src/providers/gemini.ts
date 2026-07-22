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

/** Native Google Gemini API (generateContent + function calling + streaming). */
export class GeminiProvider implements AIProvider {
  constructor(readonly config: ProviderConfig) {}

  capabilities(): ProviderCapabilities {
    return {
      chat: true, streaming: true, toolCalling: true, jsonOutput: true,
      embeddings: true, listModels: true, local: false,
    };
  }

  private base(): string {
    return (this.config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  }
  private key(): string { return this.config.apiKey ?? ""; }

  private body(messages: ChatMessageInput[], opts: GenerationOptions) {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = messages.filter((m) => m.role !== "system").map(toGeminiContent);
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: opts.maxOutputTokens,
        temperature: opts.temperature,
        topP: opts.topP,
        ...(opts.jsonMode ? { responseMimeType: "application/json" } : {}),
      },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (opts.tools?.length) {
      body.tools = [{
        functionDeclarations: opts.tools.map((t) => ({
          name: t.name, description: t.description, parameters: t.parameters,
        })),
      }];
    }
    return body;
  }

  async chat(messages: ChatMessageInput[], opts: GenerationOptions, signal?: AbortSignal): Promise<GenerateResult> {
    const url = `${this.base()}/models/${opts.model}:generateContent?key=${this.key()}`;
    const json = await apiJson<any>(url, {
      method: "POST", body: this.body(messages, opts),
      providerId: this.config.id, timeoutMs: this.config.timeoutMs, maxRetries: this.config.maxRetries, signal,
    });
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const p of parts) {
      if (p.text) text += p.text;
      if (p.functionCall) toolCalls.push({ id: nanoid(), name: p.functionCall.name, arguments: p.functionCall.args ?? {} });
    }
    return {
      text, toolCalls,
      usage: {
        inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
        cachedTokens: json.usageMetadata?.cachedContentTokenCount ?? 0,
      },
      model: opts.model, providerId: this.config.id,
      finishReason: toolCalls.length ? "tool_calls" : "stop",
    };
  }

  async *streamChat(messages: ChatMessageInput[], opts: GenerationOptions, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const url = `${this.base()}/models/${opts.model}:streamGenerateContent?alt=sse&key=${this.key()}`;
    const res = await apiFetch(url, {
      method: "POST", headers: { accept: "text/event-stream" }, body: this.body(messages, opts),
      providerId: this.config.id, timeoutMs: STREAM_TIMEOUT_MS, maxRetries: 0, signal,
    });
    let text = "";
    const toolCalls: ToolCall[] = [];
    let usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

    for await (const data of parseSSE(res)) {
      let chunk: any;
      try { chunk = JSON.parse(data); } catch { continue; }
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const p of parts) {
        if (p.text) { text += p.text; yield { type: "text", delta: p.text }; }
        if (p.functionCall) toolCalls.push({ id: nanoid(), name: p.functionCall.name, arguments: p.functionCall.args ?? {} });
      }
      if (chunk.usageMetadata) {
        usage = {
          inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
          outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
          cachedTokens: chunk.usageMetadata.cachedContentTokenCount ?? 0,
        };
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
    const url = `${this.base()}/models/${model}:batchEmbedContents?key=${this.key()}`;
    const json = await apiJson<any>(url, {
      method: "POST",
      body: { requests: texts.map((t) => ({ model: `models/${model}`, content: { parts: [{ text: t }] } })) },
      providerId: this.config.id, signal,
    });
    return {
      vectors: (json.embeddings ?? []).map((e: any) => e.values),
      model, usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const json = await apiJson<any>(`${this.base()}/models?key=${this.key()}`, { providerId: this.config.id, signal });
    return (json.models ?? []).map((m: any) => ({
      id: (m.name ?? "").replace(/^models\//, ""),
      providerId: this.config.id,
      label: m.displayName ?? m.name,
      contextWindow: m.inputTokenLimit,
      maxOutputTokens: m.outputTokenLimit,
      vision: /gemini/i.test(m.name ?? ""), // Gemini 1.5+/2.x are multimodal
    }));
  }

  countTokens(text: string): number { return estimateTokens(text); }

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

function toGeminiContent(m: ChatMessageInput): Record<string, unknown> {
  if (m.role === "tool") {
    return { role: "user", parts: [{ functionResponse: { name: m.toolCallId, response: { result: m.content } } }] };
  }
  if (m.role === "assistant" && m.toolCalls?.length) {
    const parts: unknown[] = [];
    if (m.content) parts.push({ text: m.content });
    for (const tc of m.toolCalls) parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
    return { role: "model", parts };
  }
  if (m.role === "user" && m.images?.length) {
    const parts: unknown[] = m.content ? [{ text: m.content }] : [];
    for (const uri of m.images) {
      const mt = uri.match(/^data:([^;]+);base64,(.+)$/);
      if (mt) parts.push({ inlineData: { mimeType: mt[1], data: mt[2] } });
    }
    return { role: "user", parts };
  }
  return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] };
}
