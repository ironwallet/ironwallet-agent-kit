/**
 * Durable MCP consent next to the keystore. Written by accept_mcp_consent (chat)
 * or the local manager. create / import stay blocked until the current version
 * is accepted.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveKeystoreDir } from "../local-secrets.js";
import { restrictPrivateFile } from "../restrict-private-file.js";
import { CONSENT_VERSION, consentDocument } from "./copy.js";

export const CONSENT_FILE = "mcp-consent.json";

export type ConsentChannel = "chat" | "manager";

export interface ConsentRecord {
  version: string;
  acceptedAt: string;
  channel: ConsentChannel;
}

export function consentFilePath(dir: string = resolveKeystoreDir()): string {
  return join(dir, CONSENT_FILE);
}

export function readConsent(dir?: string): ConsentRecord | undefined {
  const path = consentFilePath(dir);
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<ConsentRecord>;
    if (typeof raw.version !== "string" || !raw.version.trim()) return undefined;
    if (typeof raw.acceptedAt !== "string" || !raw.acceptedAt.trim()) return undefined;
    if (raw.channel !== "chat" && raw.channel !== "manager") return undefined;
    return {
      version: raw.version.trim(),
      acceptedAt: raw.acceptedAt,
      channel: raw.channel,
    };
  } catch {
    return undefined;
  }
}

export function hasCurrentConsent(dir?: string): boolean {
  const record = readConsent(dir);
  return record?.version === CONSENT_VERSION;
}

export function recordConsent(channel: ConsentChannel, dir?: string): ConsentRecord {
  const root = dir ?? resolveKeystoreDir();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  const record: ConsentRecord = {
    version: CONSENT_VERSION,
    acceptedAt: new Date().toISOString(),
    channel,
  };
  const path = consentFilePath(root);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  restrictPrivateFile(path);
  return record;
}

/** Payload for agents when create/import is blocked. */
export function consentRequiredPayload(): {
  needs_consent: true;
  accept: "accept_mcp_consent";
  consent: ReturnType<typeof consentDocument>;
} {
  return {
    needs_consent: true,
    accept: "accept_mcp_consent",
    consent: consentDocument(),
  };
}
