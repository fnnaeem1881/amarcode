import type { ToolResult } from "@amarcode/shared";
import { ToolContext } from "./context.js";
import { startServer, stopServer, serverStatus, waitForUrl, httpProbe } from "./devServer.js";

/**
 * Tools that let the agent run the app, test it over HTTP, and read its logs to
 * find bugs — then fix and re-test. Emits a "preview" event so the UI can show
 * the running app in the embedded browser.
 */

export async function start_dev_server(ctx: ToolContext, args: { command: string }): Promise<ToolResult> {
  if (!(await ctx.requestApproval(`Start dev server: ${args.command}`, "confirm"))) {
    return { ok: false, output: "Denied by user", error: "denied" };
  }
  startServer(ctx.root, args.command);
  const url = await waitForUrl(ctx.root);
  const st = serverStatus(ctx.root);
  if (url) ctx.emit?.({ type: "preview", payload: { url } });
  const tail = st.logs.split("\n").slice(-15).join("\n");
  if (st.exited) {
    return { ok: false, output: `Server exited (code ${st.exitCode}).\n${tail}`, error: "exited", data: { url: null } };
  }
  return {
    ok: true,
    output: url ? `Dev server running at ${url}\n${tail}` : `Dev server started (no URL detected yet)\n${tail}`,
    data: { url, running: st.running },
  };
}

export async function stop_dev_server(ctx: ToolContext): Promise<ToolResult> {
  const stopped = stopServer(ctx.root);
  return { ok: true, output: stopped ? "Dev server stopped." : "No dev server was running." };
}

export async function get_server_logs(ctx: ToolContext, args: { lines?: number }): Promise<ToolResult> {
  const st = serverStatus(ctx.root);
  if (!st.command) return { ok: true, output: "No dev server has been started." };
  const tail = st.logs.split("\n").slice(-(args.lines ?? 60)).join("\n");
  return {
    ok: true,
    output: `[${st.running ? "running" : `exited code ${st.exitCode}`}] ${st.command}\nURL: ${st.url ?? "(none)"}\n\n${tail}`,
    data: { running: st.running, url: st.url },
  };
}

/** Make an HTTP request against the running server to test an endpoint. */
export async function http_request(
  ctx: ToolContext,
  args: { path: string; method?: string; body?: string },
): Promise<ToolResult> {
  const r = await httpProbe(ctx.root, args.path, args.method ?? "GET", args.body);
  if (r.error) {
    return { ok: false, output: `Request to ${args.path} failed: ${r.error}`, error: r.error };
  }
  const verdict = r.ok ? "OK" : `HTTP ${r.status} — possible bug`;
  return {
    ok: r.ok,
    output: `${args.method ?? "GET"} ${args.path} → ${r.status} (${verdict})\n\n${r.body}`,
    data: { status: r.status, ok: r.ok },
  };
}
