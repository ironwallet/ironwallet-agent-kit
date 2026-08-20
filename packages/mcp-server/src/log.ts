/**
 * Append-only JSONL file logger for diagnosing relay/network instability.
 *
 * Writes ONLY to a file (never stdout — that carries MCP JSON-RPC). Optionally
 * mirrors to stderr when IW_LOG_STDERR=1.
 *
 * Secrets (Authorization, x-api-key, mnemonics, private keys, full signatures)
 * are redacted. Bodies are summarized by default; set IW_LOG_BODIES=1 to include
 * truncated request/response bodies (still redacted for known secret fields).
 */

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { getConfig } from "./config.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_HEADER = /^(authorization|x-api-key|cookie|set-cookie|proxy-authorization)$/i;
const SENSITIVE_KEY =
  /^(authorization|accessToken|token|password|passphrase|mnemonic|seed|privateKey|secret|x-api-key|signature|TxnSignature)$/i;

let resolvedPath: string | null | undefined;
let minLevel: LogLevel | undefined;
let bodiesEnabled: boolean | undefined;
let stderrMirror: boolean | undefined;
let warnedOnce = false;

function envFlag(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return !/^(0|false|off|no)$/i.test(v);
}

function resolveMinLevel(): LogLevel {
  if (minLevel) return minLevel;
  const raw = (process.env.IW_LOG_LEVEL ?? "info").toLowerCase();
  minLevel =
    raw === "info" || raw === "warn" || raw === "error" || raw === "debug"
      ? raw
      : "info";
  return minLevel;
}

/** Empty string / IW_LOG_ENABLED=0 disables file logging. */
export function isLogEnabled(): boolean {
  if (!envFlag("IW_LOG_ENABLED", true)) return false;
  if (process.env.IW_LOG_FILE === "") return false;
  return true;
}

export function getLogFilePath(): string | null {
  if (resolvedPath !== undefined) return resolvedPath;
  if (!isLogEnabled()) {
    resolvedPath = null;
    return null;
  }
  const override = process.env.IW_LOG_FILE?.trim();
  if (override) {
    resolvedPath = override;
    return resolvedPath;
  }
  try {
    const cfg = getConfig();
    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    resolvedPath = join(cfg.keystoreDir, "logs", `iw-mcp-${day}.jsonl`);
  } catch {
    resolvedPath = join(".", "iw-mcp-logs", `iw-mcp-${new Date().toISOString().slice(0, 10)}.jsonl`);
  }
  return resolvedPath;
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function newCorrelationId(prefix = "req"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** Walk Error.cause chains (undici nests codes here). */
export function errorDetails(err: unknown, depth = 0): Record<string, unknown> {
  if (err == null) return { value: err };
  if (!(err instanceof Error)) return { value: String(err) };
  const out: Record<string, unknown> = {
    name: err.name,
    message: err.message,
  };
  const any = err as Error & {
    code?: string;
    status?: number;
    errno?: number;
    syscall?: string;
    address?: string;
    port?: number;
    body?: string;
    cause?: unknown;
  };
  if (any.code) out.code = any.code;
  if (any.status != null) out.status = any.status;
  if (any.errno != null) out.errno = any.errno;
  if (any.syscall) out.syscall = any.syscall;
  if (any.address) out.address = any.address;
  if (any.port != null) out.port = any.port;
  if (typeof any.body === "string") out.bodyPreview = truncate(any.body, 800);
  if (any.cause != null && depth < 6) out.cause = errorDetails(any.cause, depth + 1);
  if (err.stack) out.stack = err.stack.split("\n").slice(0, 12);
  return out;
}

export function truncate(s: string, max = 2000): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…(+${s.length - max} chars)`;
}

export function redactHeaders(
  headers?: Headers | Record<string, string> | [string, string][],
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  const entries =
    headers instanceof Headers
      ? [...headers.entries()]
      : Array.isArray(headers)
        ? headers
        : Object.entries(headers);
  for (const [k, v] of entries) {
    out[k] = SENSITIVE_HEADER.test(k) ? redactValue(String(v)) : String(v);
  }
  return out;
}

function redactValue(v: string): string {
  if (!v) return "<empty>";
  if (v.length <= 12) return "<redacted>";
  return `${v.slice(0, 6)}…${v.slice(-4)} (len=${v.length})`;
}

/** Deep-redact known secret keys; truncate long strings. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > 8) return "<max-depth>";
  if (typeof value === "string") {
    if (value.length > 400) return truncate(value, 400);
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    if (value.length > 40) {
      return [
        ...value.slice(0, 20).map((v) => sanitize(v, depth + 1)),
        `<…${value.length - 20} more>`,
      ];
    }
    return value.map((v) => sanitize(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) {
        out[k] =
          typeof v === "string"
            ? redactValue(v)
            : v == null
              ? v
              : `<redacted ${typeof v}>`;
      } else {
        out[k] = sanitize(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

/** Compact summary of a JSON/text body for logs (sizes + key fields). */
export function summarizeBody(body: unknown): Record<string, unknown> | undefined {
  if (body == null || body === "") return undefined;
  const text = typeof body === "string" ? body : safeJson(body);
  const out: Record<string, unknown> = {
    bytes: Buffer.byteLength(text, "utf8"),
    chars: text.length,
  };
  try {
    const parsed = typeof body === "string" ? JSON.parse(body) : body;
    if (parsed && typeof parsed === "object") {
      out.keys = Object.keys(parsed as object);
      const p = parsed as Record<string, unknown>;
      if (p.fromAddress) out.fromAddress = p.fromAddress;
      if (p.toAddress) out.toAddress = p.toAddress;
      if (p.amount != null) out.amount = p.amount;
      if (p.tokenAddress) out.tokenAddress = p.tokenAddress;
      if (p.network) out.network = p.network;
      if (Array.isArray(p.signedTransactions)) {
        out.signedTransactions = p.signedTransactions.map((t, i) => {
          const tx = t as Record<string, unknown>;
          return {
            i,
            transactionId: tx.transactionId,
            txID: tx.txID,
            signatureLen: typeof tx.signature === "string" ? tx.signature.length : undefined,
            txDataLen: typeof tx.txData === "string" ? tx.txData.length : undefined,
          };
        });
      }
      if (p.signedEstimateResult && typeof p.signedEstimateResult === "object") {
        const se = p.signedEstimateResult as Record<string, unknown>;
        const er = se.estimateResult as Record<string, unknown> | undefined;
        out.signedEstimateResult = {
          hasSignature: typeof se.signature === "string",
          signatureLen: typeof se.signature === "string" ? se.signature.length : undefined,
          traceId: se.traceId,
          amount: er?.amount,
          coinFee: er?.coinFee,
          tokenFee: er?.tokenFee,
          txsToSign: Array.isArray(er?.transactionsToSign)
            ? er.transactionsToSign.length
            : undefined,
          timeout: er?.timeout,
        };
      }
      if (p.txHash) out.txHash = p.txHash;
      if (p.operationId) out.operationId = p.operationId;
    }
  } catch {
    out.preview = truncate(text, 300);
  }
  if (bodiesEnabled ?? (bodiesEnabled = envFlag("IW_LOG_BODIES", false))) {
    out.body = sanitize(typeof body === "string" ? tryParse(body) : body);
  }
  return out;
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function log(
  level: LogLevel,
  event: string,
  data?: Record<string, unknown>,
): void {
  if (!isLogEnabled()) return;
  if (LEVEL_RANK[level] < LEVEL_RANK[resolveMinLevel()]) return;

  const file = getLogFilePath();
  if (!file) return;

  const safeData =
    (sanitize(data ?? {}) as Record<string, unknown> | null) ?? {};
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    pid: process.pid,
    ...safeData,
  });

  try {
    ensureDir(file);
    appendFileSync(file, line + "\n", "utf8");
  } catch (e) {
    if (!warnedOnce) {
      warnedOnce = true;
      process.stderr.write(
        `[ironwallet-mcp] failed to write log file ${file}: ${
          e instanceof Error ? e.message : String(e)
        }\n`,
      );
    }
  }

  if (stderrMirror ?? (stderrMirror = envFlag("IW_LOG_STDERR", false))) {
    process.stderr.write(line + "\n");
  }
}

export function logInfo(event: string, data?: Record<string, unknown>): void {
  log("info", event, data);
}

export function logDebug(event: string, data?: Record<string, unknown>): void {
  log("debug", event, data);
}

export function logWarn(event: string, data?: Record<string, unknown>): void {
  log("warn", event, data);
}

export function logError(
  event: string,
  err: unknown,
  data?: Record<string, unknown>,
): void {
  log("error", event, { ...data, error: errorDetails(err) });
}

/** One-shot banner so operators know where logs go. */
export function logStartupBanner(extra?: Record<string, unknown>): void {
  const file = getLogFilePath();
  if (!file) {
    process.stderr.write("[ironwallet-mcp] file logging disabled\n");
    return;
  }
  logInfo("process.start", {
    logFile: file,
    logLevel: resolveMinLevel(),
    logBodies: envFlag("IW_LOG_BODIES", false),
    node: process.version,
    platform: process.platform,
    ...extra,
  });
  process.stderr.write(`[ironwallet-mcp] logging to ${file}\n`);
}
