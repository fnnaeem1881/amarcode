/** AI provider + model abstraction contracts. */

export type ProviderKind =
  | "openai"
  | "anthropic"
  | "gemini"
  | "openrouter"
  | "ollama"
  | "lmstudio"
  | "vllm"
  | "together"
  | "groq"
  | "fireworks"
  | "deepseek"
  | "mistral"
  | "azure-openai"
  | "openai-compatible";

/** How a provider speaks over the wire. Most providers reuse one of these dialects. */
export type WireProtocol = "openai" | "anthropic" | "gemini" | "ollama";

export interface ProviderCapabilities {
  chat: boolean;
  streaming: boolean;
  toolCalling: boolean;
  jsonOutput: boolean;
  embeddings: boolean;
  /** Provider exposes a model-listing endpoint we can auto-discover. */
  listModels: boolean;
  /** Provider runs locally (offline capable). */
  local: boolean;
}

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  label: string;
  enabled: boolean;
  /** Encrypted at rest; never returned raw to the client. */
  apiKey?: string;
  baseUrl?: string;
  // OpenAI
  organizationId?: string;
  // OpenRouter
  httpReferer?: string;
  appName?: string;
  // Azure
  azureEndpoint?: string;
  azureDeployment?: string;
  azureApiVersion?: string;
  // tuning
  timeoutMs?: number;
  maxRetries?: number;
}

/** Config safe to send to the UI — secrets replaced with a boolean flag. */
export type SafeProviderConfig = Omit<ProviderConfig, "apiKey"> & {
  hasApiKey: boolean;
};

export interface ModelInfo {
  id: string;
  providerId: string;
  label?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  /** Model accepts image input (vision). */
  vision?: boolean;
  /** USD per 1M tokens. */
  inputPrice?: number;
  outputPrice?: number;
}

/** Per-request generation options shared by all providers. */
export interface GenerationOptions {
  model: string;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  /** For providers that support explicit reasoning effort. */
  reasoningEffort?: "low" | "medium" | "high";
  stream?: boolean;
  parallelToolCalls?: boolean;
  tools?: ToolSchema[];
  /** Force JSON object output when supported. */
  jsonMode?: boolean;
}

export interface ToolSchema {
  name: string;
  description: string;
  /** JSON Schema for the tool's parameters. */
  parameters: Record<string, unknown>;
}

export interface ChatMessageInput {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** For role "tool": which call this responds to. */
  toolCallId?: string;
  /** For assistant messages that requested tools. */
  toolCalls?: ToolCall[];
  /** Attached images as data URIs (data:image/png;base64,…) — vision input. */
  images?: string[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
}

export interface GenerateResult {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  model: string;
  providerId: string;
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | "error";
}

/** A single streamed event from the unified interface. */
export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "usage"; usage: Usage }
  | { type: "done"; result: GenerateResult }
  | { type: "error"; message: string };

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  usage: Usage;
}

export interface HealthCheckResult {
  ok: boolean;
  latencyMs?: number;
  models?: string[];
  version?: string;
  error?: string;
}

/** Which model handles which stage of the workflow. */
export interface ModelRouting {
  planning?: ModelRef;
  coding?: ModelRef;
  refactoring?: ModelRef;
  embeddings?: ModelRef;
  titleGeneration?: ModelRef;
  /** Ordered fallback chain used when the primary model is unavailable. */
  fallback?: ModelRef[];
}

export interface ModelRef {
  providerId: string;
  model: string;
}
