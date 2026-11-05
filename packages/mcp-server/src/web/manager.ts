/**
 * Local browser-based wallet manager. An MCP tool starts this and hands the
 * user a URL; the seed phrase is only ever typed into / shown by this page in
 * the user's browser and never crosses the agent boundary.
 *
 * Security posture:
 *   - binds 127.0.0.1 only and checks the Host header (DNS rebinding),
 *   - all routes live under an unguessable random token path (a capability),
 *   - API writes need a same-origin JSON request (see security.ts),
 *   - the server self-destructs after a period of inactivity.
 *
 * The UI is the single-page app from web/ (built into dist/web-ui); it talks to
 * the JSON API in api.ts. Deleting a wallet is a manager-only action (no MCP
 * tool): it is irreversible and destroys the local copy of a seed, so it needs
 * a human in the browser rather than an agent acting on a chat phrase.
 */

import { createServer, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadKeystore } from "../keystore/store.js";
import { logError, logInfo } from "../log.js";
import {
  depositCaption,
  depositPayload,
  renderDepositQrPng,
  renderPlainQrPng,
  uniqueDepositTargets,
  walletOwnsDeposit,
} from "../qr/deposit-qr.js";
import type { NetworkId } from "../networks.js";
import { handleApi } from "./api.js";
import { serveIcon } from "./icons.js";
import { readPrefs } from "./prefs.js";
import { hostAllowed, sendAppHtml, sendStatic } from "./security.js";

const INACTIVITY_MS = 15 * 60 * 1000;

interface Manager {
  url: string;
  server: Server;
}

let current: Manager | null = null;
let inactivityTimer: NodeJS.Timeout | null = null;
let idleMs = INACTIVITY_MS;

function armInactivityTimer(): void {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = null;
  if (idleMs <= 0) return;
  inactivityTimer = setTimeout(() => shutdown(), idleMs);
  inactivityTimer.unref?.();
}

function shutdown(): void {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = null;
  const c = current;
  current = null;
  c?.server.close();
}

const NO_STORE = "no-store, no-cache, must-revalidate, private";

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, { Location: location, "Cache-Control": NO_STORE });
  res.end();
}

function text(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": NO_STORE,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  });
  res.end(body);
}

/**
 * The single-page app built by `vite build` (web/ → dist/web-ui). From the
 * compiled server it sits next to dist/web; under tsx (src/web) it is the
 * package's dist/web-ui.
 */
function uiDir(): string | null {
  for (const rel of ["../web-ui/", "../../dist/web-ui/"]) {
    const dir = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(join(dir, "index.html"))) return dir;
  }
  return null;
}

const STATIC_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function serveApp(res: ServerResponse): void {
  const dir = uiDir();
  if (!dir) {
    text(res, 503, "The wallet manager UI is not built. Run `npm run build` in packages/mcp-server.");
    return;
  }
  sendAppHtml(res, withTheme(readFileSync(join(dir, "index.html"), "utf8")));
}

/** A saved theme goes onto <html> up front, so the page never paints in the OS scheme first. */
function withTheme(html: string): string {
  const theme = readPrefs().theme;
  return theme ? html.replace(/<html\b/, `<html data-theme="${theme}"`) : html;
}

/** `/static/<file>`: flat directory of hashed bundle files; no subpaths, no traversal. */
function serveStatic(res: ServerResponse, name: string): boolean {
  if (!/^[\w.-]+$/.test(name) || name.startsWith(".")) return false;
  const type = STATIC_TYPES[extname(name)];
  const dir = uiDir();
  if (!type || !dir) return false;
  const path = join(dir, "static", name);
  if (!existsSync(path)) return false;
  sendStatic(res, type, readFileSync(path));
  return true;
}

/**
 * `/qr?network=&address=`: deposit QR PNG, linked as `qr_url` by get_deposit_qr.
 * `&plain=1` drops the caption: the manager's Receive card prints it itself.
 */
async function serveQr(res: ServerResponse, params: URLSearchParams): Promise<void> {
  const network = params.get("network") ?? "";
  const address = params.get("address") ?? "";
  const owner = loadKeystore().wallets.find((w) => walletOwnsDeposit(w.addresses, network, address));
  if (!owner) {
    text(res, 404, "Unknown address.");
    return;
  }
  const target =
    uniqueDepositTargets(owner.addresses).find(
      (t) => t.network === network && t.address === address,
    ) ?? { network: network as NetworkId, address };
  const payload = depositPayload(network, address);
  const png =
    params.get("plain") === "1"
      ? await renderPlainQrPng(payload)
      : await renderDepositQrPng(address, payload, depositCaption(target));
  res.writeHead(200, {
    "Content-Type": "image/png",
    "Cache-Control": NO_STORE,
    "X-Content-Type-Options": "nosniff",
  });
  res.end(png);
}

/** Stop the manager now instead of waiting for the inactivity timeout (tests, shutdown). */
export function closeManager(): void {
  shutdown();
}

/**
 * Start the manager (or reuse a running one) and return its base URL.
 * `idleMs` (first start only) overrides the inactivity shutdown; 0 disables it
 * for the local dev server.
 */
export async function ensureManager(opts: { idleMs?: number } = {}): Promise<string> {
  if (current) {
    armInactivityTimer();
    logInfo("manager.reuse", { url: current.url });
    return current.url;
  }

  idleMs = opts.idleMs ?? INACTIVITY_MS;
  const token = randomBytes(16).toString("hex");
  const base = `/${token}`;
  let port = 0;
  logInfo("manager.start", { base });

  const server = createServer((req, res) => {
    armInactivityTimer();
    if (!hostAllowed(req, port)) {
      logInfo("manager.request.bad_host", { host: req.headers.host });
      text(res, 421, "Misdirected request.");
      return;
    }
    const raw = req.url ?? "";
    const q = raw.indexOf("?");
    const url = q < 0 ? raw : raw.slice(0, q);
    const query = q < 0 ? "" : raw.slice(q + 1);
    if (url !== base && !url.startsWith(`${base}/`)) {
      text(res, 404, "Not found.");
      return;
    }
    const method = req.method ?? "GET";
    // Relative `api/` and `static/` URLs in the app only resolve under a trailing slash.
    if (url === base) {
      redirect(res, `${base}/`);
      return;
    }
    const sub = url.slice(base.length);
    logInfo("manager.request", { method, path: sub });

    if (sub.startsWith("/api/")) {
      void handleApi(req, res, sub.slice("/api".length), port, new URLSearchParams(query));
      return;
    }
    if (method !== "GET") {
      text(res, 405, "Method not allowed.");
      return;
    }
    if (sub === "/") {
      serveApp(res);
      return;
    }
    if (sub.startsWith("/static/")) {
      if (!serveStatic(res, sub.slice("/static/".length))) text(res, 404, "Not found.");
      return;
    }
    const icon = /^\/icons\/([a-z]+)\/([A-Za-z0-9_-]{1,64})$/.exec(sub);
    if (icon) {
      serveIcon(res, icon[1], icon[2]).catch((e) => {
        logError("manager.icon.fail", e, {});
        if (!res.headersSent) text(res, 500, "Could not load the icon.");
      });
      return;
    }
    if (sub === "/qr") {
      serveQr(res, new URLSearchParams(query)).catch((e) => {
        logError("manager.qr.fail", e, {});
        if (!res.headersSent) text(res, 500, "Could not render the QR code.");
      });
      return;
    }
    text(res, 404, "Not found.");
  });

  return new Promise<string>((resolve, reject) => {
    server.on("error", (e) => {
      logError("manager.listen.fail", e, {});
      reject(e);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr !== "object") {
        reject(new Error("failed to bind manager server"));
        return;
      }
      port = addr.port;
      const url = `http://127.0.0.1:${addr.port}${base}`;
      current = { url, server };
      armInactivityTimer();
      logInfo("manager.listen.ok", { url });
      resolve(url);
    });
  });
}
