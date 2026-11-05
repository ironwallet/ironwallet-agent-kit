/**
 * Request gating and response headers for the local wallet manager.
 *
 * The random path token is the capability; these checks close the gaps it
 * leaves open:
 *   - Host must name the loopback listener, so a DNS-rebinding page served
 *     from an attacker domain that resolves to 127.0.0.1 is refused;
 *   - API writes must be same-origin JSON: a cross-site HTML form cannot send
 *     `application/json`, and browsers always attach Origin to non-GET fetches.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

export function allowedHosts(port: number): Set<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
}

export function allowedOrigins(port: number): Set<string> {
  return new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
}

export function hostAllowed(req: IncomingMessage, port: number): boolean {
  const host = (req.headers.host ?? "").toLowerCase();
  return allowedHosts(port).has(host);
}

/** Why an API write is refused, or null when it may proceed. */
export function apiWriteRejection(req: IncomingMessage, port: number): string | null {
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins(port).has(origin.toLowerCase())) {
    return "Cross-origin request refused.";
  }
  const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    return "Expected application/json.";
  }
  return null;
}

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  Pragma: "no-cache",
  Expires: "0",
} as const;

const COMMON = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const;

/** CSP for the single-page app: every script, style, font and image is a bundled file. */
export const APP_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function sendAppHtml(res: ServerResponse, body: Buffer | string): void {
  res.writeHead(200, {
    ...NO_STORE,
    ...COMMON,
    "Content-Type": "text/html; charset=utf-8",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": APP_CSP,
  });
  res.end(body);
}

/** Hashed bundle files never change under the same name. */
export function sendStatic(res: ServerResponse, type: string, body: Buffer): void {
  res.writeHead(200, {
    ...COMMON,
    "Content-Type": type,
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  res.end(body);
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    ...NO_STORE,
    ...COMMON,
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(body));
}
