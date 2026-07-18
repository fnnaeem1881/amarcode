import { ProviderError } from "./types.js";

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  providerId: string;
}

/** fetch with timeout, JSON body handling and bounded retries on 429/5xx. */
export async function apiFetch(url: string, opts: FetchOptions): Promise<Response> {
  const { timeoutMs = 60_000, maxRetries = 2, providerId } = opts;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    // Chain caller cancellation into our controller.
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: {
          "content-type": "application/json",
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal,
      });

      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        await sleep(backoff(attempt));
        continue;
      }
      if (!res.ok) {
        const detail = await safeText(res);
        throw new ProviderError(
          `HTTP ${res.status}: ${detail.slice(0, 500)}`,
          providerId,
          res.status,
        );
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (opts.signal?.aborted) throw new ProviderError("Request cancelled", providerId);
      if (attempt >= maxRetries) break;
      await sleep(backoff(attempt));
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
  throw lastErr instanceof Error
    ? new ProviderError(lastErr.message, providerId)
    : new ProviderError("Request failed", providerId);
}

export async function apiJson<T>(url: string, opts: FetchOptions): Promise<T> {
  const res = await apiFetch(url, opts);
  return (await res.json()) as T;
}

/** Parse a Server-Sent-Events stream into `data:` payloads. */
export async function* parseSSE(res: Response): AsyncGenerator<string> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.startsWith("data:")) {
        yield line.slice(5).trim();
      }
    }
  }
}

function backoff(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 4000) + Math.random() * 250;
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
