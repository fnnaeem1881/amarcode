import type {
  IndexStats, ModelInfo, ProjectMetadata, SafeProviderConfig,
  ChatSession, StoredMessage, Plan, ModelRouting, ToolDescriptor,
} from "@amarcode/shared";

/** Thin typed client over the engine's REST API. */
async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  // providers
  listProviders: () => j<SafeProviderConfig[]>("/api/providers"),
  saveProvider: (cfg: Partial<SafeProviderConfig> & { apiKey?: string }) =>
    j<SafeProviderConfig>("/api/providers", { method: "POST", body: JSON.stringify(cfg) }),
  deleteProvider: (id: string) => j(`/api/providers/${id}`, { method: "DELETE" }),
  testProvider: (id: string) => j<{ ok: boolean; latencyMs?: number; models?: string[]; error?: string }>(`/api/providers/${id}/test`, { method: "POST" }),
  listModels: (id: string) => j<ModelInfo[]>(`/api/providers/${id}/models`),
  getRouting: () => j<ModelRouting>("/api/routing"),
  saveRouting: (r: ModelRouting) => j("/api/routing", { method: "POST", body: JSON.stringify(r) }),

  // project
  scan: (root: string) => j<ProjectMetadata>("/api/project/scan", { method: "POST", body: JSON.stringify({ root }) }),
  index: (root: string) => j<IndexStats>("/api/project/index", { method: "POST", body: JSON.stringify({ root }) }),
  embed: (root: string) => j<{ ok: boolean }>("/api/project/embed", { method: "POST", body: JSON.stringify({ root }) }),
  files: (root: string) => j<{ path: string; language: string; size: number; symbols: number; importance: number }[]>(`/api/project/files?root=${encodeURIComponent(root)}`),
  file: (root: string, path: string) => j<{ path: string; content: string }>(`/api/project/file?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`),
  metadata: (root: string) => j<ProjectMetadata>(`/api/project/metadata?root=${encodeURIComponent(root)}`),

  // fs browse
  browse: (dir?: string) => j<{ dir: string; entries: string[] }>(`/api/fs/list${dir ? `?dir=${encodeURIComponent(dir)}` : ""}`),

  // sessions
  sessions: (root: string) => j<ChatSession[]>(`/api/sessions?root=${encodeURIComponent(root)}`),
  createSession: (root: string, title?: string) => j<ChatSession>("/api/sessions", { method: "POST", body: JSON.stringify({ root, title }) }),
  messages: (id: string) => j<StoredMessage[]>(`/api/sessions/${id}/messages`),

  // planner + tools + cost + memory
  plan: (sessionId: string, root: string, task: string) => j<Plan>("/api/plan", { method: "POST", body: JSON.stringify({ sessionId, root, task }) }),
  tools: () => j<ToolDescriptor[]>("/api/tools"),
  cost: () => j<any>("/api/cost"),
  memory: (root: string) => j<any>(`/api/memory?root=${encodeURIComponent(root)}`),
};
