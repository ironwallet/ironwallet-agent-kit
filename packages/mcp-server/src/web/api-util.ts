/** Shared plumbing for the manager JSON API handlers. */

import type { IncomingMessage } from "node:http";
import { hasCurrentConsent } from "../consent/store.js";
import type { ApiErrorCode } from "./contract.js";

const MAX_BODY_BYTES = 64 * 1024;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Parse a JSON object body. Error messages never quote the body: it may hold a recovery phrase. */
export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "bad_request", "Request body too large.");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "bad_request", "Malformed JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "bad_request", "Expected a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string") throw new HttpError(400, "bad_request", `"${key}" must be a string.`);
  return value;
}

/** Create, import, rename and delete wait for the current MCP disclaimer. */
export function requireConsent(): void {
  if (!hasCurrentConsent()) {
    throw new HttpError(403, "consent_required", "Accept the disclaimer first.");
  }
}
