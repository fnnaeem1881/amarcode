import type { ProviderConfig, ProviderKind } from "@amarcode/shared";
import type { AIProvider } from "./types.js";
import { OpenAICompatibleProvider } from "./openaiCompatible.js";
import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { OllamaProvider } from "./ollama.js";

/**
 * Maps a provider kind to a concrete implementation. Adding a brand-new
 * provider only requires either reusing an existing wire dialect (set
 * `kind: "openai-compatible"` with a baseUrl) or adding one case here.
 */
export function createProvider(config: ProviderConfig): AIProvider {
  switch (config.kind) {
    case "anthropic":
      return new AnthropicProvider(config);
    case "gemini":
      return new GeminiProvider(config);
    case "ollama":
      return new OllamaProvider(config);
    // Everything else speaks the OpenAI dialect with a different base URL.
    default:
      return new OpenAICompatibleProvider(config);
  }
}

/** Default scaffolding for a freshly-added provider of a given kind. */
export function defaultConfigFor(kind: ProviderKind): Partial<ProviderConfig> {
  const common = { enabled: true, timeoutMs: 60_000, maxRetries: 2 };
  const labels: Record<ProviderKind, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic (Claude)",
    gemini: "Google Gemini",
    openrouter: "OpenRouter",
    ollama: "Ollama (Local)",
    lmstudio: "LM Studio",
    vllm: "vLLM",
    together: "Together AI",
    groq: "Groq",
    fireworks: "Fireworks AI",
    deepseek: "DeepSeek",
    mistral: "Mistral AI",
    "azure-openai": "Azure OpenAI",
    "openai-compatible": "OpenAI-Compatible",
  };
  return { ...common, kind, label: labels[kind] };
}
