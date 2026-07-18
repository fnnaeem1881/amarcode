import type { ProviderKind } from "@amarcode/shared";
import { configStore } from "./providers/configStore.js";
import { defaultConfigFor } from "./providers/factory.js";

/**
 * On first run, seed disabled placeholder configs for the common providers so
 * the AI Settings page has something to fill in. No API keys are set; nothing
 * is enabled until the user provides credentials.
 */
export function seedDefaultProviders(): void {
  if (configStore.listProviders().length > 0) return;
  const kinds: ProviderKind[] = ["openai", "anthropic", "gemini", "openrouter", "ollama"];
  for (const kind of kinds) {
    configStore.upsertProvider({
      id: kind,
      apiKey: undefined,
      ...defaultConfigFor(kind),
      enabled: kind === "ollama", // Ollama is safe to enable (local, no key).
    } as any);
  }
}
