import { DatabaseSync } from "node:sqlite";
import { dbPath } from "./paths.js";

/**
 * SQLite cache/store built on Node's built-in `node:sqlite` (no native build).
 * Holds provider config, project metadata, the file index, embeddings,
 * chat sessions/messages, plans, memory and cost records.
 */

let _db: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (_db) return _db;
  _db = new DatabaseSync(dbPath());
  _db.exec("PRAGMA journal_mode = WAL;");
  _db.exec("PRAGMA foreign_keys = ON;");
  migrate(_db);
  return _db;
}

function migrate(d: DatabaseSync): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      root TEXT PRIMARY KEY,
      metadata_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS files (
      root TEXT NOT NULL,
      path TEXT NOT NULL,
      entry_json TEXT NOT NULL,
      hash TEXT NOT NULL,
      PRIMARY KEY (root, path)
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      root TEXT NOT NULL,
      path TEXT NOT NULL,
      chunk INTEGER NOT NULL,
      text TEXT NOT NULL,
      vector TEXT NOT NULL,
      PRIMARY KEY (root, path, chunk)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_root TEXT NOT NULL,
      title TEXT NOT NULL,
      provider_id TEXT,
      model TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls_json TEXT,
      tool_call_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory (
      project_root TEXT PRIMARY KEY,
      memory_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS costs (
      id TEXT PRIMARY KEY,
      project_root TEXT,
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cached_tokens INTEGER NOT NULL,
      estimated_cost REAL NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Incremental migrations (ignore "duplicate column" on existing DBs).
  try { d.exec("ALTER TABLE sessions ADD COLUMN kind TEXT DEFAULT 'code'"); } catch { /* already exists */ }
  try { d.exec("ALTER TABLE messages ADD COLUMN images_json TEXT"); } catch { /* already exists */ }
}
