import type { ChatMessageInput, GenerateResult, GenerationOptions, ModelRef, StreamEvent } from "@amarcode/shared";
import type { AIProvider } from "./types.js";
import { createProvider } from "./factory.js";
import { configStore } from "./configStore.js";

export type WorkflowTask = "planning" | "coding" | "refactoring" | "embeddings" | "titleGeneration";

/**
 * The single entry point every request funnels through. Resolves which
 * provider+model to use for a given task, builds the provider instance, and
 * transparently retries down the fallback chain when a provider is unavailable.
 */
export class ProviderRouter {
  getProvider(providerId: string): AIProvider {
    const cfg = configStore.getProvider(providerId);
    if (!cfg) throw new Error(`Unknown provider: ${providerId}`);
    if (!cfg.enabled) throw new Error(`Provider disabled: ${providerId}`);
    return createProvider(cfg);
  }

  /** Resolve the model for a workflow stage, honouring explicit overrides. */
  resolve(task: WorkflowTask, override?: ModelRef): ModelRef {
    if (override) return override;
    const routing = configStore.getRouting();
    const forTask = routing[task];
    if (forTask) return forTask;
    const fallback = routing.fallback?.[0];
    if (fallback) return fallback;
    // Last resort: first enabled provider's first model-less ref.
    const first = configStore.listProviders().find((p) => p.enabled);
    if (!first) throw new Error("No AI provider configured. Add one in AI Settings.");
    return { providerId: first.id, model: configStore.getSetting("defaultModel", "") };
  }

  /** Ordered [primary, ...fallbacks] for a task. */
  private chain(task: WorkflowTask, override?: ModelRef): ModelRef[] {
    const primary = this.resolve(task, override);
    const fallbacks = configStore.getRouting().fallback ?? [];
    const seen = new Set<string>();
    return [primary, ...fallbacks].filter((r) => {
      const key = `${r.providerId}:${r.model}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async chat(
    task: WorkflowTask,
    messages: ChatMessageInput[],
    opts: Omit<GenerationOptions, "model"> & { model?: string },
    override?: ModelRef,
    signal?: AbortSignal,
  ): Promise<GenerateResult> {
    let lastErr: unknown;
    for (const ref of this.chain(task, override)) {
      try {
        const provider = this.getProvider(ref.providerId);
        return await provider.chat(messages, { ...opts, model: opts.model ?? ref.model }, signal);
      } catch (err) {
        if (signal?.aborted) throw err;
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("All providers in the fallback chain failed");
  }

  async *streamChat(
    task: WorkflowTask,
    messages: ChatMessageInput[],
    opts: Omit<GenerationOptions, "model"> & { model?: string },
    override?: ModelRef,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    let lastErr: unknown;
    for (const ref of this.chain(task, override)) {
      try {
        const provider = this.getProvider(ref.providerId);
        yield* provider.streamChat(messages, { ...opts, model: opts.model ?? ref.model }, signal);
        return;
      } catch (err) {
        if (signal?.aborted) throw err;
        lastErr = err;
      }
    }
    yield { type: "error", message: lastErr instanceof Error ? lastErr.message : "All providers failed" };
  }
}

export const router = new ProviderRouter();
