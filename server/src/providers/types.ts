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
} from "@amarcode/shared";

/**
 * The unified AI interface. Every provider implements exactly this.
 * Adding a new provider = one class implementing AIProvider + a factory entry.
 * No business logic anywhere else depends on a concrete provider.
 */
export interface AIProvider {
  readonly config: ProviderConfig;
  capabilities(): ProviderCapabilities;

  /** Non-streaming completion (may still emit tool calls). */
  chat(
    messages: ChatMessageInput[],
    opts: GenerationOptions,
    signal?: AbortSignal,
  ): Promise<GenerateResult>;

  /** Streaming completion. Yields text deltas, tool calls, usage, then done. */
  streamChat(
    messages: ChatMessageInput[],
    opts: GenerationOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent>;

  generateEmbedding(
    texts: string[],
    model: string,
    signal?: AbortSignal,
  ): Promise<EmbeddingResult>;

  /** Auto-discover available models when the provider supports it. */
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;

  /** Rough token count for budgeting (heuristic when no API is available). */
  countTokens(text: string): number;

  healthCheck(signal?: AbortSignal): Promise<HealthCheckResult>;
}

/** ~4 chars per token is a good cross-model heuristic for budgeting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
