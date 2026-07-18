import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/** Root directory where AmarCode stores its config, DB and secrets. */
export function appDataDir(): string {
  const base =
    process.env.AMARCODE_HOME ??
    path.join(os.homedir(), ".amarcode");
  fs.mkdirSync(base, { recursive: true });
  return base;
}

export function dbPath(): string {
  return path.join(appDataDir(), "amarcode.db");
}

export function secretKeyPath(): string {
  return path.join(appDataDir(), "secret.key");
}
