import type { ModelRouting, ProviderConfig, SafeProviderConfig } from "@amarcode/shared";
import { db } from "../core/db.js";
import { decryptSecret, encryptSecret, isEncrypted } from "../core/crypto.js";

/**
 * Persists provider configs (with encrypted API keys) and global settings
 * such as the default model and the multi-model routing table.
 */
export class ConfigStore {
  /** All provider configs with decrypted keys — server-side use only. */
  listProviders(): ProviderConfig[] {
    const rows = db().prepare("SELECT config_json FROM providers").all() as { config_json: string }[];
    return rows.map((r) => {
      const cfg = JSON.parse(r.config_json) as ProviderConfig;
      if (isEncrypted(cfg.apiKey)) cfg.apiKey = decryptSecret(cfg.apiKey!);
      return cfg;
    });
  }

  getProvider(id: string): ProviderConfig | undefined {
    return this.listProviders().find((p) => p.id === id);
  }

  /** UI-safe view: secrets replaced with a boolean flag. */
  listSafe(): SafeProviderConfig[] {
    return this.listProviders().map(toSafe);
  }

  upsertProvider(cfg: ProviderConfig): SafeProviderConfig {
    const stored: ProviderConfig = { ...cfg };
    if (stored.apiKey && !isEncrypted(stored.apiKey)) {
      stored.apiKey = encryptSecret(stored.apiKey);
    }
    db()
      .prepare("INSERT INTO providers (id, config_json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json")
      .run(cfg.id, JSON.stringify(stored));
    return toSafe(cfg);
  }

  deleteProvider(id: string): void {
    db().prepare("DELETE FROM providers WHERE id = ?").run(id);
  }

  getSetting<T>(key: string, fallback: T): T {
    const row = db().prepare("SELECT value_json FROM settings WHERE key = ?").get(key) as
      | { value_json: string } | undefined;
    return row ? (JSON.parse(row.value_json) as T) : fallback;
  }

  setSetting<T>(key: string, value: T): void {
    db()
      .prepare("INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json")
      .run(key, JSON.stringify(value));
  }

  getRouting(): ModelRouting {
    return this.getSetting<ModelRouting>("routing", {});
  }
  setRouting(routing: ModelRouting): void {
    this.setSetting("routing", routing);
  }
}

function toSafe(cfg: ProviderConfig): SafeProviderConfig {
  const { apiKey, ...rest } = cfg;
  return { ...rest, hasApiKey: !!apiKey };
}

export const configStore = new ConfigStore();
