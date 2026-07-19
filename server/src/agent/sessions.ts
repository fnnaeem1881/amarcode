import { nanoid } from "nanoid";
import type { ChatMessageInput, ChatSession, StoredMessage } from "@amarcode/shared";
import { db } from "../core/db.js";

/** Chat session + message persistence. */
export function createSession(projectRoot: string, title = "New chat"): ChatSession {
  const now = new Date().toISOString();
  const s: ChatSession = { id: nanoid(), projectRoot, title, createdAt: now, updatedAt: now };
  db().prepare("INSERT INTO sessions (id, project_root, title, provider_id, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(s.id, s.projectRoot, s.title, null, null, now, now);
  return s;
}

export function listSessions(projectRoot: string): ChatSession[] {
  const rows = db().prepare("SELECT * FROM sessions WHERE project_root = ? ORDER BY updated_at DESC").all(projectRoot) as any[];
  return rows.map(rowToSession);
}

/** Every session across all projects (for the Claude-Code-style global list). */
export function listAllSessions(): ChatSession[] {
  const rows = db().prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all() as any[];
  return rows.map(rowToSession);
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
  db().prepare("INSERT INTO messages (id, session_id, role, content, tool_calls_json, tool_call_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(stored.id, sessionId, stored.role, stored.content, stored.toolCalls ? JSON.stringify(stored.toolCalls) : null, stored.toolCallId ?? null, stored.createdAt);
  db().prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(stored.createdAt, sessionId);
  return stored;
}

export function getMessages(sessionId: string): StoredMessage[] {
  const rows = db().prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC").all(sessionId) as any[];
  return rows.map((r) => ({
    id: r.id, sessionId: r.session_id, role: r.role, content: r.content,
    toolCalls: r.tool_calls_json ? JSON.parse(r.tool_calls_json) : undefined,
    toolCallId: r.tool_call_id ?? undefined, createdAt: r.created_at,
  }));
}

/**
 * History for the model, applying a sliding window + summary of older turns to
 * cap token usage (older tool spam is dropped; user/assistant text kept).
 */
export function historyForModel(sessionId: string, keep = 12): ChatMessageInput[] {
  const all = getMessages(sessionId);
  const recent = all.slice(-keep);
  return recent.map((m) => ({
    role: m.role, content: m.content, toolCalls: m.toolCalls, toolCallId: m.toolCallId,
  }));
}

function rowToSession(r: any): ChatSession {
  return {
    id: r.id, projectRoot: r.project_root, title: r.title,
    providerId: r.provider_id ?? undefined, model: r.model ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
