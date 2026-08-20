/**
 * Fetch helper with JSON handling, per-attempt timeouts and bounded retries.
 *
 * Timeouts: every attempt is aborted after `timeoutMs` (default from config).
 * Retries: transient failures (network errors, timeouts, and retryable HTTP
 * statuses like 429/5xx) are retried with exponential backoff + jitter, honoring
 * a `Retry-After` header when present.
 *
 * Safety: retries default ON for idempotent methods (GET/HEAD) and OFF for others
 * (a broadcast POST must never be silently resent). Callers can override this per
 * request with `retry: true` for read-only POSTs (e.g. auth, Tron node reads).
 *
 * Every attempt is written to the JSONL file logger (see src/log.ts) with
 * timings, status, retry decisions and undici cause chains — without secrets.
 */

import { getConfig } from "../config.js";
import {
  errorDetails,
  logDebug,
  logError,
  logInfo,
  logWarn,
  newCorrelationId,
  redactHeaders,
  summarizeBody,
  truncate,
} from "../log.js";

export interface HttpError extends Error {
  status?: number;
  body?: string;
}

export interface HttpOptions {
  /** Force-enable/disable retries regardless of method. */
  retry?: boolean;
  /** Override the number of retry attempts for this call. */
  retries?: number;
  /** Override the per-attempt timeout (ms) for this call. */
  timeoutMs?: number;
  /** Correlation id for log lines (auto-generated if omitted). */
  correlationId?: string;
  /** Short label for logs, e.g. "relay.forward". */
  label?: string;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function isIdempotent(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Backoff for attempt N (0-based): ~0.3s, 0.6s, 1.2s … capped, plus jitter. */
function backoffMs(attempt: number, retryAfter?: string | null): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs)) return Math.min(30000, Math.max(0, secs * 1000));
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.min(30000, Math.max(0, date - Date.now()));
  }
  const base = Math.min(4000, 300 * 2 ** attempt);
  return base + Math.floor(Math.random() * 250);
}

function pickResponseHeaders(res: Response): Record<string, string> {
  const interesting = [
    "content-type",
    "content-length",
    "retry-after",
    "x-request-id",
    "x-correlation-id",
    "x-amzn-trace-id",
    "cf-ray",
    "date",
    "server",
  ];
  const out: Record<string, string> = {};
  for (const h of interesting) {
    const v = res.headers.get(h);
    if (v) out[h] = v;
  }
  return out;
}

export async function httpJson<T>(
  url: string,
  init: RequestInit & { headers?: Record<string, string> },
  opts: HttpOptions = {},
): Promise<T> {
  const cfg = getConfig();
  const method = (init.method ?? "GET").toUpperCase();
  const timeoutMs = opts.timeoutMs ?? cfg.httpTimeoutMs;
  const retriesEnabled = opts.retry ?? isIdempotent(method);
  const maxRetries = retriesEnabled ? opts.retries ?? cfg.httpRetries : 0;
  const correlationId = opts.correlationId ?? newCorrelationId("http");
  const label = opts.label ?? "http";
  const startedAt = Date.now();
  const bodyText =
    typeof init.body === "string"
      ? init.body
      : init.body != null
        ? String(init.body)
        : undefined;

  logInfo("http.request.start", {
    correlationId,
    label,
    method,
    url,
    timeoutMs,
    retriesEnabled,
    maxRetries,
    headers: redactHeaders(init.headers),
    body: summarizeBody(bodyText),
  });

  let attempt = 0;
  for (;;) {
    const attemptStarted = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let timedOut = false;
    controller.signal.addEventListener("abort", () => {
      timedOut = true;
    });

    logDebug("http.attempt.start", {
      correlationId,
      label,
      method,
      url,
      attempt,
      maxRetries,
      timeoutMs,
      elapsedMs: Date.now() - startedAt,
    });

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const headersMs = Date.now() - attemptStarted;
      const text = await res.text();
      const totalAttemptMs = Date.now() - attemptStarted;

      if (!res.ok) {
        const willRetry = attempt < maxRetries && RETRYABLE_STATUS.has(res.status);
        logWarn("http.attempt.http_error", {
          correlationId,
          label,
          method,
          url,
          attempt,
          status: res.status,
          statusText: res.statusText,
          headersMs,
          totalAttemptMs,
          responseHeaders: pickResponseHeaders(res),
          bodyPreview: truncate(text, 800),
          willRetry,
          retryableStatus: RETRYABLE_STATUS.has(res.status),
        });
        if (willRetry) {
          clearTimeout(timer);
          const wait = backoffMs(attempt, res.headers.get("retry-after"));
          logInfo("http.retry", {
            correlationId,
            label,
            attempt,
            nextAttempt: attempt + 1,
            waitMs: wait,
            reason: `HTTP ${res.status}`,
          });
          await delay(wait);
          attempt++;
          continue;
        }
        const err: HttpError = new Error(
          `HTTP ${res.status} for ${method} ${url}: ${text.slice(0, 500)}`,
        );
        err.status = res.status;
        err.body = text;
        logError("http.request.fail", err, {
          correlationId,
          label,
          method,
          url,
          attempts: attempt + 1,
          elapsedMs: Date.now() - startedAt,
          kind: "http_status",
        });
        throw err;
      }

      logInfo("http.attempt.ok", {
        correlationId,
        label,
        method,
        url,
        attempt,
        status: res.status,
        headersMs,
        bodyMs: totalAttemptMs - headersMs,
        totalAttemptMs,
        elapsedMs: Date.now() - startedAt,
        responseHeaders: pickResponseHeaders(res),
        body: summarizeBody(text),
      });

      logInfo("http.request.ok", {
        correlationId,
        label,
        method,
        url,
        attempts: attempt + 1,
        elapsedMs: Date.now() - startedAt,
        status: res.status,
      });

      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    } catch (e) {
      // HttpError (non-retryable status) bubbles straight up (already logged).
      if (e instanceof Error && "status" in e) throw e;

      const attemptMs = Date.now() - attemptStarted;
      const transient = timedOut || isTransport(e);
      const willRetry = attempt < maxRetries && transient;

      logWarn("http.attempt.transport_error", {
        correlationId,
        label,
        method,
        url,
        attempt,
        timedOut,
        timeoutMs,
        attemptMs,
        elapsedMs: Date.now() - startedAt,
        isTransport: isTransport(e),
        willRetry,
        error: errorDetails(e),
      });

      if (willRetry) {
        const wait = backoffMs(attempt);
        logInfo("http.retry", {
          correlationId,
          label,
          attempt,
          nextAttempt: attempt + 1,
          waitMs: wait,
          reason: timedOut ? "timeout" : "transport",
        });
        await delay(wait);
        attempt++;
        continue;
      }

      if (timedOut) {
        const err = new Error(
          `Request timed out after ${timeoutMs}ms for ${method} ${url}` +
            (attempt > 0 ? ` (after ${attempt + 1} attempts)` : ""),
        );
        logError("http.request.fail", err, {
          correlationId,
          label,
          method,
          url,
          attempts: attempt + 1,
          elapsedMs: Date.now() - startedAt,
          kind: "timeout",
          timeoutMs,
          note:
            method === "POST" && /\/forward$/.test(url)
              ? "Broadcast may still have been accepted by the relay — check balances before retrying."
              : undefined,
        });
        throw err;
      }

      const msg = e instanceof Error ? e.message : String(e);
      const err = new Error(`Network error for ${method} ${url}: ${msg}`);
      logError("http.request.fail", err, {
        correlationId,
        label,
        method,
        url,
        attempts: attempt + 1,
        elapsedMs: Date.now() - startedAt,
        kind: "transport",
        cause: errorDetails(e),
        note:
          method === "POST" && /\/forward$/.test(url)
            ? "Connection dropped after send; relay may still have processed the request — check balances before retrying."
            : undefined,
      });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Transport-level failures worth retrying (DNS/connection resets, fetch failed). */
function isTransport(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  // undici surfaces network issues as TypeError('fetch failed') with a cause.
  if (e.name === "TypeError") return true;
  const code = (e as { code?: string }).code;
  if (code && ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "EPIPE"].includes(code)) {
    return true;
  }
  const cause = (e as { cause?: { code?: string } }).cause;
  if (cause?.code && ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "EPIPE", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"].includes(cause.code)) {
    return true;
  }
  return false;
}
