import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Encrypted secret store for the in-process agent (e.g. the NVIDIA API key).
 *
 * Secrets live in `userData/secrets.json`, each value encrypted with Electron's
 * `safeStorage` (Windows DPAPI / macOS Keychain / libsecret). If OS encryption is
 * unavailable (some headless Linux dev boxes) we fall back to base64 so the app still
 * works — never plaintext in the clear, and never committed to the repo.
 *
 * This replaces the old Python `SecretStore` for everything the shipped app needs, so a
 * dead backend can no longer block secret storage.
 */

interface StoredSecret {
  /** Whether the value was sealed with OS encryption (true) or only base64 (false). */
  enc: boolean;
  /** base64 of the encrypted buffer, or base64 of the raw utf8 when enc === false. */
  val: string;
}

function file(): string {
  const dir = app.getPath("userData");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "secrets.json");
}

function readAll(): Record<string, StoredSecret> {
  try {
    return JSON.parse(readFileSync(file(), "utf8")) as Record<string, StoredSecret>;
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, StoredSecret>): void {
  writeFileSync(file(), JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function setSecret(key: string, value: string): void {
  const all = readAll();
  if (safeStorage.isEncryptionAvailable()) {
    all[key] = { enc: true, val: safeStorage.encryptString(value).toString("base64") };
  } else {
    all[key] = { enc: false, val: Buffer.from(value, "utf8").toString("base64") };
  }
  writeAll(all);
}

export function getSecret(key: string): string | undefined {
  const rec = readAll()[key];
  if (!rec) return undefined;
  try {
    if (rec.enc) return safeStorage.decryptString(Buffer.from(rec.val, "base64"));
    return Buffer.from(rec.val, "base64").toString("utf8");
  } catch {
    return undefined;
  }
}

export function hasSecret(key: string): boolean {
  return !!readAll()[key];
}

/** Canonical key name for the NVIDIA API key, used across the agent. */
export const API_KEY_NAME = "NVIDIA_API_KEY";

/**
 * Resolve the API key WITHOUT ever storing it in the repo. Order:
 *   1. a key the user pasted (encrypted in `userData/secrets.json`),
 *   2. the `ACTIG_API_KEY` environment variable,
 *   3. a `~/.actig/api_key` file (one line) the user drops once.
 * This lets ACTIG run with no in-app typing while keeping the secret on the user's machine.
 */
export function resolveApiKey(): string {
  const stored = getSecret(API_KEY_NAME);
  if (stored) return stored;
  if (process.env.ACTIG_API_KEY?.trim()) return process.env.ACTIG_API_KEY.trim();
  try {
    const f = join(homedir(), ".actig", "api_key");
    if (existsSync(f)) return readFileSync(f, "utf8").trim();
  } catch {
    /* ignore */
  }
  return "";
}
