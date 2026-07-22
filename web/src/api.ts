import type {
  IndexStats, ModelInfo, ProjectMetadata, SafeProviderConfig,
  ChatSession, StoredMessage, Plan, ModelRouting, ToolDescriptor,
} from "@amarcode/shared";

export interface DirEntry { name: string; path: string; hasChildren: boolean; isProject: boolean }
export interface DirListing {
  dir: string;
  parent: string | null;
  entries: DirEntry[];
  crumbs: { label: string; path: string }[];
}

export interface GitStatusFile { path: string; index: string; working: string; staged: boolean }
export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitStatusFile[];
  tracking: string | null;
}

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
  // Set one provider+model as the active default for all core stages.
  useModel: async (providerId: string, model: string) => {
    const ref = { providerId, model };
    await j("/api/routing", { method: "POST", body: JSON.stringify({ planning: ref, coding: ref, refactoring: ref, fallback: [ref] }) });
    await j("/api/settings/defaultModel", { method: "POST", body: JSON.stringify({ value: model }) });
  },
  getSetting: (key: string) => j<{ value: any }>(`/api/settings/${key}`),
  setSetting: (key: string, value: any) => j(`/api/settings/${key}`, { method: "POST", body: JSON.stringify({ value }) }),

  // project
  scan: (root: string) => j<ProjectMetadata>("/api/project/scan", { method: "POST", body: JSON.stringify({ root }) }),
  index: (root: string) => j<IndexStats>("/api/project/index", { method: "POST", body: JSON.stringify({ root }) }),
  embed: (root: string) => j<{ ok: boolean }>("/api/project/embed", { method: "POST", body: JSON.stringify({ root }) }),
  files: (root: string) => j<{ path: string; language: string; size: number; symbols: number; importance: number }[]>(`/api/project/files?root=${encodeURIComponent(root)}`),
  file: (root: string, path: string) => j<{ path: string; content: string }>(`/api/project/file?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`),
  metadata: (root: string) => j<ProjectMetadata>(`/api/project/metadata?root=${encodeURIComponent(root)}`),

  // fs browse
  fsRoots: () => j<{ roots: { label: string; path: string }[]; home: string }>("/api/fs/roots"),
  browse: (dir?: string) => j<DirListing>(`/api/fs/list${dir ? `?dir=${encodeURIComponent(dir)}` : ""}`),
  fsValidate: (path: string) => j<{ valid: boolean; isDirectory: boolean; path: string }>(`/api/fs/validate?path=${encodeURIComponent(path)}`),

  // sessions
  sessions: (root: string) => j<ChatSession[]>(`/api/sessions?root=${encodeURIComponent(root)}`),
  allSessions: () => j<ChatSession[]>("/api/sessions/all"),
  createSession: (root: string, title?: string) => j<ChatSession>("/api/sessions", { method: "POST", body: JSON.stringify({ root, title }) }),
  deleteSession: (id: string) => j(`/api/sessions/${id}`, { method: "DELETE" }),
  messages: (id: string) => j<StoredMessage[]>(`/api/sessions/${id}/messages`),
  renameSession: (id: string, title: string) => j(`/api/sessions/${id}/title`, { method: "POST", body: JSON.stringify({ title }) }),

  // image generation
  generateImage: (providerId: string, model: string, prompt: string) =>
    j<{ images: string[] }>("/api/image/generate", { method: "POST", body: JSON.stringify({ providerId, model, prompt }) }),

  // preview / dev server
  previewStatus: (root: string) => j<{ running: boolean; url: string | null; command: string | null; logs: string; exited: boolean; exitCode: number | null }>(`/api/preview/status?root=${encodeURIComponent(root)}`),
  previewStart: (root: string, command: string) => j<{ running: boolean; url: string | null; logs: string }>("/api/preview/start", { method: "POST", body: JSON.stringify({ root, command }) }),
  previewStop: (root: string) => j("/api/preview/stop", { method: "POST", body: JSON.stringify({ root }) }),

  // git
  gitStatus: (root: string) => j<GitStatus>(`/api/git/status?root=${encodeURIComponent(root)}`),
  gitDiff: (root: string, path?: string, staged?: boolean) => j<{ diff: string }>(`/api/git/diff?root=${encodeURIComponent(root)}${path ? `&path=${encodeURIComponent(path)}` : ""}${staged ? "&staged=true" : ""}`),
  gitBranches: (root: string) => j<{ current: string; all: string[] }>(`/api/git/branches?root=${encodeURIComponent(root)}`),
  gitLog: (root: string) => j<{ hash: string; message: string; author: string; date: string }[]>(`/api/git/log?root=${encodeURIComponent(root)}`),
  gitInit: (root: string) => j("/api/git/init", { method: "POST", body: JSON.stringify({ root }) }),
  gitStage: (root: string, path?: string, all?: boolean) => j("/api/git/stage", { method: "POST", body: JSON.stringify({ root, path, all }) }),
  gitUnstage: (root: string, path: string) => j("/api/git/unstage", { method: "POST", body: JSON.stringify({ root, path }) }),
  gitCommit: (root: string, message: string) => j<{ commit: string; changes: number }>("/api/git/commit", { method: "POST", body: JSON.stringify({ root, message }) }),
  gitCheckout: (root: string, ref: string) => j("/api/git/checkout", { method: "POST", body: JSON.stringify({ root, ref }) }),
  gitBranch: (root: string, name: string) => j("/api/git/branch", { method: "POST", body: JSON.stringify({ root, name }) }),
  gitDiscard: (root: string, path: string) => j("/api/git/discard", { method: "POST", body: JSON.stringify({ root, path, confirm: true }) }),

  // planner + tools + cost + memory
  plan: (sessionId: string, root: string, task: string) => j<Plan>("/api/plan", { method: "POST", body: JSON.stringify({ sessionId, root, task }) }),
  tools: () => j<ToolDescriptor[]>("/api/tools"),
  cost: () => j<any>("/api/cost"),
  memory: (root: string) => j<any>(`/api/memory?root=${encodeURIComponent(root)}`),
};
