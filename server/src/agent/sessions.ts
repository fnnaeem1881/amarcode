import { nanoid } from "nanoid";
import type { ChatMessageInput, ChatSession, StoredMessage } from "@amarcode/shared";
import { db } from "../core/db.js";

/** Chat session + message persistence. */
export function createSession(projectRoot: string, title = "New chat", kind: "home" | "code" = "code", mode: "chat" | "image" | "video" = "chat"): ChatSession {
  const now = new Date().toISOString();
  const s: ChatSession = { id: nanoid(), projectRoot, title, kind, mode, createdAt: now, updatedAt: now };
  db().prepare("INSERT INTO sessions (id, project_root, title, provider_id, model, kind, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(s.id, s.projectRoot, s.title, null, null, kind, mode, now, now);
  return s;
}

export function listSessions(projectRoot: string): ChatSession[] {
  const rows = db().prepare("SELECT * FROM sessions WHERE project_root = ? ORDER BY updated_at DESC").all(projectRoot) as any[];
  return rows.map(rowToSession);
}

/** Every session across all projects, with a last-message preview snippet. */
export function listAllSessions(): ChatSession[] {
  const rows = db().prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS msg_count,
      (SELECT m.content FROM messages m WHERE m.session_id = s.id AND m.content != ''
         ORDER BY m.created_at DESC LIMIT 1) AS last_text,
      (SELECT m.images_json IS NOT NULL FROM messages m WHERE m.session_id = s.id
         ORDER BY m.created_at DESC LIMIT 1) AS last_media
    FROM sessions s ORDER BY s.updated_at DESC
  `).all() as any[];
  return rows.map((r) => ({
    ...rowToSession(r),
    msgCount: Number(r.msg_count ?? 0),
    preview: r.last_media && !r.last_text
      ? (r.mode === "video" ? "🎬 generated video" : "🎨 generated image")
      : (r.last_text ? String(r.last_text).replace(/\s+/g, " ").slice(0, 90) : undefined),
  }));
}

export function setSessionMode(id: string, mode: "chat" | "image" | "video"): void {
  db().prepare("UPDATE sessions SET mode = ? WHERE id = ?").run(mode, id);
}

export function deleteSession(id: string): void {
  db().prepare("DELETE FROM messages WHERE session_id = ?").run(id);
  db().prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export function getSession(id: string): ChatSession | undefined {
  const row = db().prepare("SELECT * FROM sessions WHERE id = ?").get(id) as any;
  return row ? rowToSession(row) : undefined;
}

export function setSessionModel(id: string, providerId?: string, model?: string): void {
  db().prepare("UPDATE sessions SET provider_id = ?, model = ?, updated_at = ? WHERE id = ?")
    .run(providerId ?? null, model ?? null, new Date().toISOString(), id);
}

export function renameSession(id: string, title: string): void {
  db().prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?").run(title, new Date().toISOString(), id);
}

export function addMessage(sessionId: string, msg: Omit<StoredMessage, "id" | "sessionId" | "createdAt">): StoredMessage {
  const stored: StoredMessage = { id: nanoid(), sessionId, createdAt: new Date().toISOString(), ...msg };
  db().prepare("INSERT INTO messages (id, session_id, role, content, tool_calls_json, tool_call_id, images_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(stored.id, sessionId, stored.role, stored.content, stored.toolCalls ? JSON.stringify(stored.toolCalls) : null, stored.toolCallId ?? null, stored.images && stored.images.length ? JSON.stringify(stored.images) : null, stored.createdAt);
  db().prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(stored.createdAt, sessionId);
  return stored;
}

export function getMessages(sessionId: string): StoredMessage[] {
  const rows = db().prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC").all(sessionId) as any[];
  return rows.map((r) => ({
    id: r.id, sessionId: r.session_id, role: r.role, content: r.content,
    toolCalls: r.tool_calls_json ? JSON.parse(r.tool_calls_json) : undefined,
    toolCallId: r.tool_call_id ?? undefined,
    images: r.images_json ? JSON.parse(r.images_json) : undefined,
    createdAt: r.created_at,
  }));
}

/**
 * History for the model, applying a sliding window + summary of older turns to
 * cap token usage (older tool spam is dropped; user/assistant text kept).
 */
export function historyForModel(sessionId: string, keep = 12): ChatMessageInput[] {
  const all = getMessages(sessionId);
  const recent = all.slice(-keep);
  // Cap total history size so one huge past reply can't bloat the request and
  // make it slow/fail. Truncate long messages and bound the overall budget.
  const MAX_MSG_CHARS = 4000;
  const MAX_TOTAL_CHARS = 24_000;
  let total = 0;
  const out: ChatMessageInput[] = [];
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    let content = m.content ?? "";
    if (content.length > MAX_MSG_CHARS) content = content.slice(0, MAX_MSG_CHARS) + "\n…[truncated]";
    if (total + content.length > MAX_TOTAL_CHARS && out.length) break;
    total += content.length;
    out.unshift({ role: m.role, content, toolCalls: m.toolCalls, toolCallId: m.toolCallId });
  }
  return out;
}

function rowToSession(r: any): ChatSession {
  return {
    id: r.id, projectRoot: r.project_root, title: r.title,
    kind: (r.kind === "home" ? "home" : "code"),
    mode: (r.mode === "image" || r.mode === "video" ? r.mode : "chat"),
    providerId: r.provider_id ?? undefined, model: r.model ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
