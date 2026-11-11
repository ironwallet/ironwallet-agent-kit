/**
 * `/icons/<network>/<assetId>`: token icons proxied from static resources.
 * The app's CSP only allows same-origin images, and the browser never talks
 * to a third party. Icons are cached on disk next to the keystore; only
 * catalog entries are fetched (the client cannot pick a URL), and only
 * PNG / JPEG / WebP bytes are stored and served.
 */

import type { ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assetIconPath,
  isNetworkId,
  markStaticHostDown,
  markStaticHostOk,
  networkAssets,
  staticRequests,
  type StaticRequest,
} from "../api/catalog.js";
import { resolveKeystoreDir } from "../local-secrets.js";
import { logWarn } from "../log.js";

const MAX_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 10000;
const MISS_TTL_MS = 10 * 60 * 1000;

const misses = new Map<string, number>();

type ImageType = "image/png" | "image/jpeg" | "image/webp";

/** Sniff the image type from its magic bytes; anything else is refused. */
export function imageType(bytes: Buffer): ImageType | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

function cacheDir(network: string): string {
  return join(resolveKeystoreDir(), "icon-cache", network);
}

async function download(req: StaticRequest): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(req.url, { signal: controller.signal, redirect: "error", headers: req.headers });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length <= MAX_BYTES && imageType(bytes) ? bytes : null;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadFirst(path: string): Promise<Buffer | null> {
  for (const req of staticRequests(path)) {
    try {
      const bytes = await download(req);
      markStaticHostOk(req.base);
      if (bytes) return bytes;
    } catch {
      markStaticHostDown(req.base);
    }
  }
  return null;
}

async function loadIcon(network: string, assetId: string): Promise<Buffer | null> {
  if (!isNetworkId(network) || !/^[A-Za-z0-9_-]{1,64}$/.test(assetId)) return null;
  const file = join(cacheDir(network), `${assetId}.img`);
  if (existsSync(file)) {
    const cached = readFileSync(file);
    if (imageType(cached)) return cached;
  }
  const key = `${network}/${assetId}`;
  const missAt = misses.get(key);
  if (missAt && Date.now() - missAt < MISS_TTL_MS) return null;

  const asset = (await networkAssets(network)).find((a) => a.assetId === assetId);
  const path = asset && assetIconPath(asset);
  const bytes = path ? await downloadFirst(path) : null;
  if (!bytes) {
    misses.set(key, Date.now());
    return null;
  }
  try {
    mkdirSync(cacheDir(network), { recursive: true });
    writeFileSync(file, bytes);
  } catch (e) {
    logWarn("manager.icon.cache_fail", { key, error: e instanceof Error ? e.message : String(e) });
  }
  return bytes;
}

export async function serveIcon(res: ServerResponse, network: string, assetId: string): Promise<void> {
  const bytes = await loadIcon(network, assetId);
  const type = bytes && imageType(bytes);
  if (!bytes || !type) {
    res.writeHead(404, { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'none'",
  });
  res.end(bytes);
}
