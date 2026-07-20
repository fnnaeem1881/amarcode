import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { nanoid } from "nanoid";
import { runAgent, type AgentEvent } from "../agent/agentLoop.js";
import * as sessions from "../agent/sessions.js";
import * as devServer from "../tools/devServer.js";

/**
 * Streaming chat channel. Protocol (JSON messages):
 *   client → { type: "chat", sessionId, root, task, override? }
 *   client → { type: "approval", id, approved }
 *   client → { type: "cancel" }
 *   server → AgentEvent (text / tool_start / tool_result / approval_request / done / error)
 */
export function attachWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket) => {
    const pendingApprovals = new Map<string, (approved: boolean) => void>();
    let abort: AbortController | null = null;

    const send = (e: AgentEvent | Record<string, unknown>) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(e));
    };

    ws.on("message", async (raw) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === "approval") {
        pendingApprovals.get(msg.id)?.(!!msg.approved);
        pendingApprovals.delete(msg.id);
        return;
      }
      if (msg.type === "cancel") {
        abort?.abort();
        return;
      }
      if (msg.type !== "chat") return;

      const { sessionId, root, task, override, previewUrl, lite, images } = msg;
      abort = new AbortController();

      // Let the agent's http_request target the URL the user is running/previewing.
      if (previewUrl) devServer.setExternalUrl(root, previewUrl);

      // Persist the user's message.
      if (sessionId) sessions.addMessage(sessionId, { role: "user", content: task });
      const history = sessionId ? sessions.historyForModel(sessionId).slice(0, -1) : [];

      try {
        const finalText = await runAgent({
          root, task, history, override, lite: !!lite, images: Array.isArray(images) ? images : undefined, signal: abort.signal,
          emit: (e) => send(e),
          requestApproval: (action, risk, detail) =>
            new Promise<boolean>((resolve) => {
              const id = nanoid();
              pendingApprovals.set(id, resolve);
              send({ type: "approval_request", id, action, risk, detail });
              // Auto-deny if the socket closes mid-approval.
              ws.once("close", () => { if (pendingApprovals.has(id)) { pendingApprovals.delete(id); resolve(false); } });
            }),
        });
        if (sessionId && finalText) sessions.addMessage(sessionId, { role: "assistant", content: finalText });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      }
    });

    ws.on("close", () => { abort?.abort(); pendingApprovals.clear(); });
  });
}
