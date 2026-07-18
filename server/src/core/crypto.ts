import crypto from "node:crypto";
import fs from "node:fs";
import { secretKeyPath } from "./paths.js";

/**
 * Symmetric encryption for API keys at rest (AES-256-GCM).
 * The master key lives in a file readable only by the current user.
 * Keys are never logged and never returned raw over the API.
 */

const ALGO = "aes-256-gcm";

function masterKey(): Buffer {
  const p = secretKeyPath();
  if (fs.existsSync(p)) {
    return fs.readFileSync(p);
  }
  const key = crypto.randomBytes(32);
  // 0o600 — owner read/write only (best-effort on Windows).
  fs.writeFileSync(p, key, { mode: 0o600 });
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== "v1") throw new Error("Unsupported secret format");
  const decipher = crypto.createDecipheriv(
    ALGO,
    masterKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** True when a stored value is an encrypted payload (not a legacy plaintext). */
export function isEncrypted(value: string | undefined): boolean {
  return !!value && value.startsWith("v1:");
}
