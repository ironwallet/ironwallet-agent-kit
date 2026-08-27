/**
 * Machine-local secrets and install identity. Generated on first use and stored
 * under the keystore directory (owner-only). Not written to User env, mcp.json, or
 * the plugin dashboard.
 *
 * Env vars still win when set to a real value. Unexpanded `${VAR}` placeholders
 * (Claude Code when the shell var is missing) are treated as unset.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { restrictPrivateFile } from "./restrict-private-file.js";

const RELAY_KEY_FILE = "relay-api-key";
const PASSPHRASE_FILE = "keystore-passphrase";
const DEVICE_ID_FILE = "device-id";

export function resolveKeystoreDir(): string {
  if (process.env.IW_KEYSTORE_DIR) return process.env.IW_KEYSTORE_DIR;
  const home =
    process.env.HOME ??
    process.env.USERPROFILE ??
    process.env.HOMEPATH ??
    ".";
  return `${home}/.ironwallet-mcp`;
}

export function isUnsetSecret(value: string | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  return /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(trimmed);
}

function readOrCreate(filename: string, generate: () => string): string {
  const dir = resolveKeystoreDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, filename);
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8").trim();
    if (existing.length > 0 && !isUnsetSecret(existing)) return existing;
  }
  const value = generate();
  writeFileSync(path, `${value}\n`, { mode: 0o600 });
  restrictPrivateFile(path);
  return value;
}

/** x-api-key for relay and swap APIs. UUID, stable per machine directory. */
export function resolveRelayApiKey(): string {
  const fromEnv = process.env.IW_RELAY_API_KEY;
  if (!isUnsetSecret(fromEnv)) return fromEnv!.trim();
  return readOrCreate(RELAY_KEY_FILE, () => randomUUID());
}

/** Keystore wrapping secret. Not the recovery phrase. */
export function resolveKeystorePassphrase(): string {
  const fromEnv = process.env.IW_PASSPHRASE;
  if (!isUnsetSecret(fromEnv)) return fromEnv!.trim();
  return readOrCreate(PASSPHRASE_FILE, () => randomBytes(24).toString("base64url"));
}

/** X-Device-Id. UUID, stable per keystore directory. */
export function resolveDeviceId(): string {
  const fromEnv = process.env.IW_DEVICE_ID;
  if (!isUnsetSecret(fromEnv)) return fromEnv!.trim();
  return readOrCreate(DEVICE_ID_FILE, () => randomUUID());
}
