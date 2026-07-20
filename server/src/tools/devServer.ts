import { spawn, type ChildProcess } from "node:child_process";

/**
 * Manages long-running dev servers per project. Unlike run_terminal (which has
 * a timeout), a dev server started here keeps running until explicitly stopped
 * or the engine exits — so the agent can start it, test against it, read its
 * logs to find bugs, fix, and re-test.
 */
interface RunningServer {
  proc: ChildProcess;
  command: string;
  url: string | null;
  logs: string;
  startedAt: number;
  exited: boolean;
  exitCode: number | null;
}

const servers = new Map<string, RunningServer>(); // keyed by project root
const externalUrls = new Map<string, string>(); // URLs the user is previewing/ran themselves

/** Register a URL the user is running/previewing so http_request can target it. */
export function setExternalUrl(root: string, url: string): void {
  if (url && url.trim()) externalUrls.set(root, url.trim());
}

/** Best-known base URL for a project: our dev server, else the user's preview. */
export function knownUrl(root: string): string | null {
  return servers.get(root)?.url ?? externalUrls.get(root) ?? null;
}

export function detectUrl(text: string): string | null {
  const direct = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/i);
  if (direct) return `http://localhost:${direct[1]}`;
  const port = text.match(/(?:listening|running|started|ready|serving|available)\b[^\d]{0,20}(\d{4,5})/i);
  if (port) return `http://localhost:${port[1]}`;
  return null;
}

export function startServer(root: string, command: string): void {
  stopServer(root);
  const proc = spawn(command, { cwd: root, shell: true });
  const s: RunningServer = { proc, command, url: null, logs: "", startedAt: Date.now(), exited: false, exitCode: null };
  const onData = (b: Buffer) => {
    const chunk = b.toString();
    s.logs = (s.logs + chunk).slice(-60_000);
    if (!s.url) { const u = detectUrl(chunk); if (u) s.url = u; }
  };
  proc.stdout?.on("data", onData);
  proc.stderr?.on("data", onData);
  proc.on("exit", (code) => { s.exited = true; s.exitCode = code; s.logs += `\n[server process exited with code ${code}]`; });
  proc.on("error", (e) => { s.logs += `\n[failed to start: ${e.message}]`; s.exited = true; });
  servers.set(root, s);
}

export function stopServer(root: string): boolean {
  const s = servers.get(root);
  if (!s) return false;
  killTree(s.proc.pid);
  servers.delete(root);
  return true;
}

export interface ServerStatus {
  running: boolean;
  url: string | null;
  command: string | null;
  logs: string;
  exited: boolean;
  exitCode: number | null;
  uptimeMs: number;
}

export function serverStatus(root: string): ServerStatus {
  const s = servers.get(root);
  if (!s) return { running: false, url: null, command: null, logs: "", exited: false, exitCode: null, uptimeMs: 0 };
  return {
    running: !s.exited, url: s.url, command: s.command, logs: s.logs,
    exited: s.exited, exitCode: s.exitCode, uptimeMs: Date.now() - s.startedAt,
  };
}

/** Wait (up to timeoutMs) for the server to print a URL. */
export async function waitForUrl(root: string, timeoutMs = 12_000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = servers.get(root);
    if (!s) return null;
    if (s.url) return s.url;
    if (s.exited) return null;
    await sleep(300);
  }
  return servers.get(root)?.url ?? null;
}

/** HTTP request against the running server (or an absolute URL) to test it. */
export async function httpProbe(
  root: string,
  path: string,
  method = "GET",
  body?: string,
): Promise<{ ok: boolean; status: number; body: string; error?: string }> {
  const isAbs = path.startsWith("http");
  const base = knownUrl(root);
  if (!isAbs && !base) {
    return {
      ok: false, status: 0, body: "",
      error: "No running server is known for this project. Start one with start_dev_server, or pass a full URL (e.g. http://localhost:5319/).",
    };
  }
  const url = isAbs ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const text = (await res.text()).slice(0, 4000);
    return { ok: res.ok, status: res.status, body: text };
  } catch (e) {
    return { ok: false, status: 0, body: "", error: e instanceof Error ? e.message : String(e) };
  }
}

function killTree(pid?: number): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(pid), "/t", "/f"]);
    else process.kill(-pid, "SIGTERM");
  } catch { /* already gone */ }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
