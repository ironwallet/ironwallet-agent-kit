/**
 * Public static asset catalog, the same one the mobile app reads:
 *   GET {base}/assets/<branch>/blockchains/<dir>/assets.mainnet.json
 * `base` is each of `staticCdnUrls`, then the MCP proxy (`staticResourcesUrl`).
 * Rates use the catalog to map token contracts to `externalId`s; the wallet
 * manager uses it for token names, decimals, icons and which tokens are shown
 * by default (`default: true`).
 *
 * The last good copy of each catalog is kept on disk, so a restart or a CDN
 * outage never leaves the manager without its token list.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commonHeaders, getConfig } from "../config.js";
import { ALL_NETWORKS, NETWORK_LABEL, type NetworkId } from "../networks.js";
import { logInfo, logWarn } from "../log.js";
import { NATIVE_SYMBOL } from "./balances.js";

export interface CatalogAsset {
  asset_id?: string;
  symbol?: string;
  name?: string;
  /** Token contract / mint / jetton master; absent for the native coin. */
  address?: string;
  decimals?: number;
  displayDecimals?: number;
  default?: boolean;
  externalId?: string;
  /** Relative to the network directory, e.g. `assets/<asset_id>/logo.png`. */
  logoUri?: string;
  status?: string;
  /** Token standard shown next to the name, e.g. ERC20, BEP20, TRC20. */
  type?: string;
}

export interface AssetCatalogDocument {
  assets?: CatalogAsset[];
}

/** One asset of a network as the manager uses it. */
export interface Asset {
  network: NetworkId;
  assetId: string;
  symbol: string;
  name: string;
  /** null for the native coin. */
  address: string | null;
  decimals: number;
  displayDecimals: number;
  externalId?: string;
  isDefault: boolean;
  logoUri?: string;
  standard?: string;
}

/** Catalog directory names that differ from our network ids. */
const CATALOG_DIR: Partial<Record<NetworkId, string>> = { doge: "dogecoin" };

export const NATIVE_DECIMALS: Record<NetworkId, number> = {
  ethereum: 18,
  bsc: 18,
  polygon: 18,
  base: 18,
  arbitrum: 18,
  optimism: 18,
  avalanche: 18,
  tron: 6,
  bitcoin: 8,
  litecoin: 8,
  doge: 8,
  solana: 9,
  ton: 9,
  xrp: 6,
};

/** Asset id used when the catalog has no entry for the native coin. */
export const NATIVE_ASSET_ID = "native";

const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
/** A failed fetch is not retried on every request while the CDN is down. */
const CATALOG_FAIL_TTL_MS = 60 * 1000;
/**
 * Hosts are raced, not tried one by one: when a host has not delivered the
 * catalog after HEDGE_MS the next one starts too, and the first catalog that
 * arrives wins. A dead host then costs HEDGE_MS instead of a full timeout.
 */
const HEDGE_MS = 1500;
/** Until response headers. Long on purpose: with hedging a slow host blocks no one. */
const HEADERS_TIMEOUT_MS = 10_000;
/** From headers to the parsed body; the Ethereum catalog is about 1 MB. */
const BODY_TIMEOUT_MS = 30_000;
/** A CDN host that failed to connect goes to the end of the chain for this long. */
const CDN_DOWN_MS = 5 * 60 * 1000;

/** HTTP validators of a catalog copy, sent back so an unchanged catalog costs a bodiless 304. */
interface Validators {
  etag?: string;
  lastModified?: string;
}

interface Fetched extends Validators {
  doc: AssetCatalogDocument;
}

/** `fresh` until a refetch is due; `doc` stays the last good copy across failed refetches. */
const cache = new Map<NetworkId, { fresh: number; doc: AssetCatalogDocument | undefined } & Validators>();
const inflight = new Map<NetworkId, Promise<AssetCatalogDocument | undefined>>();
const hosts = new Map<string, { downUntil?: number; okAt?: number }>();

/** Test hook: forgets the catalogs in memory and on disk, and host health. */
export function clearCatalogCache(): void {
  cache.clear();
  inflight.clear();
  hosts.clear();
  rmSync(diskDir(), { recursive: true, force: true });
}

/** Test hook: every cached catalog is due for a refetch. */
export function expireCatalogCache(): void {
  for (const entry of cache.values()) entry.fresh = 0;
}

export interface StaticRequest {
  base: string;
  url: string;
  headers?: Record<string, string>;
}

/**
 * Where to fetch a static file from, in order: CDN hosts that are up, the one
 * that answered last first; then hosts that recently failed to connect, the
 * longest-failed first (when every host is down, order still moves on); then
 * the MCP proxy.
 */
export function staticRequests(path: string): StaticRequest[] {
  const cfg = getConfig();
  const now = Date.now();
  const downUntil = (base: string) => hosts.get(base)?.downUntil ?? 0;
  const okAt = (base: string) => hosts.get(base)?.okAt ?? 0;
  const up = cfg.staticCdnUrls.filter((b) => downUntil(b) <= now).sort((a, b) => okAt(b) - okAt(a));
  const down = cfg.staticCdnUrls.filter((b) => downUntil(b) > now).sort((a, b) => downUntil(a) - downUntil(b));
  const out: StaticRequest[] = [...up, ...down].map((base) => ({ base, url: `${base}${path}` }));
  if (cfg.staticResourcesUrl) {
    out.push({
      base: cfg.staticResourcesUrl,
      url: `${cfg.staticResourcesUrl}${path}`,
      headers: commonHeaders(cfg),
    });
  }
  return out;
}

/** For connect errors and timeouts only; an HTTP status means the host is up. */
export function markStaticHostDown(base: string): void {
  if (!getConfig().staticCdnUrls.includes(base)) return;
  hosts.set(base, { ...hosts.get(base), downUntil: Date.now() + CDN_DOWN_MS });
}

/** A host that served a file is up again and goes first next time. */
export function markStaticHostOk(base: string): void {
  if (!getConfig().staticCdnUrls.includes(base)) return;
  hosts.set(base, { okAt: Date.now() });
}

function diskDir(): string {
  const cfg = getConfig();
  return join(cfg.keystoreDir, "catalog-cache", cfg.staticAssetsBranch);
}

function diskFile(network: NetworkId): string {
  return join(diskDir(), `${network}.json`);
}

function isCatalog(value: unknown): value is AssetCatalogDocument {
  return typeof value === "object" && value !== null && Array.isArray((value as AssetCatalogDocument).assets);
}

function validator(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 256 ? value : undefined;
}

function readDisk(network: NetworkId): (Fetched & { savedAt: number }) | undefined {
  try {
    const entry = JSON.parse(readFileSync(diskFile(network), "utf8")) as Record<string, unknown>;
    if (typeof entry.savedAt !== "number" || !isCatalog(entry.doc)) return undefined;
    return {
      savedAt: Math.min(entry.savedAt, Date.now()),
      doc: entry.doc,
      etag: validator(entry.etag),
      lastModified: validator(entry.lastModified),
    };
  } catch {
    return undefined;
  }
}

/** Written through a temp file, so a crash or a second MCP process never leaves half a catalog. */
function writeDisk(network: NetworkId, fetched: Fetched): void {
  const file = diskFile(network);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(diskDir(), { recursive: true });
    writeFileSync(tmp, JSON.stringify({ savedAt: Date.now(), ...fetched }));
    renameSync(tmp, file);
  } catch (e) {
    logWarn("catalog.disk.write_fail", { network, error: e instanceof Error ? e.message : String(e) });
    try {
      rmSync(tmp, { force: true });
    } catch {
      // Left for the next write to overwrite.
    }
  }
}

function networkPath(network: NetworkId): string {
  return `/assets/${getConfig().staticAssetsBranch}/blockchains/${CATALOG_DIR[network] ?? network}`;
}

export function isNetworkId(value: string): value is NetworkId {
  return (ALL_NETWORKS as readonly string[]).includes(value);
}

/**
 * The raw catalog of one network, or `undefined` when it has never been
 * fetched. Once a copy is in hand (in memory, or on disk from an earlier run)
 * it is served at once, also while a due refetch runs in the background: the
 * catalog changes rarely, and a CDN outage must not hold every caller for the
 * whole host chain.
 */
export async function fetchCatalog(
  network: NetworkId,
  correlationId?: string,
): Promise<AssetCatalogDocument | undefined> {
  let cached = cache.get(network);
  if (!cached) {
    const disk = readDisk(network);
    if (disk) {
      cached = { fresh: disk.savedAt + CATALOG_TTL_MS, doc: disk.doc, etag: disk.etag, lastModified: disk.lastModified };
      cache.set(network, cached);
      logInfo("catalog.disk", { correlationId, network, ageMs: Date.now() - disk.savedAt });
    }
  }
  if (cached && Date.now() < cached.fresh) return cached.doc;
  const run = refreshCatalog(network, correlationId);
  return cached?.doc ?? run;
}

function refreshCatalog(network: NetworkId, correlationId?: string): Promise<AssetCatalogDocument | undefined> {
  const pending = inflight.get(network);
  if (pending) return pending;
  const prev = cache.get(network);
  const run = loadCatalog(network, correlationId, prev?.doc ? { ...prev, doc: prev.doc } : undefined)
    .catch(() => undefined)
    .then((loaded) => {
      if (loaded) {
        writeDisk(network, loaded);
        cache.set(network, { fresh: Date.now() + CATALOG_TTL_MS, ...loaded });
        return loaded.doc;
      }
      const last = cache.get(network);
      cache.set(network, { ...last, fresh: Date.now() + CATALOG_FAIL_TTL_MS, doc: last?.doc });
      return last?.doc;
    })
    .finally(() => inflight.delete(network));
  inflight.set(network, run);
  return run;
}

/**
 * Load every network catalog: from disk when an earlier run saved one, with
 * a background refetch for stale copies. Called once at process start and not
 * awaited: stdio has to come up immediately, and the wallet manager's first
 * token list otherwise waits on these downloads. A request that arrives while
 * this is still running joins the same in-flight fetch.
 */
export function warmCatalogs(): Promise<void> {
  const started = Date.now();
  return Promise.all(ALL_NETWORKS.map((network) => fetchCatalog(network)))
    .then((docs) => {
      logInfo("catalog.warm", {
        elapsedMs: Date.now() - started,
        failed: ALL_NETWORKS.filter((_, i) => docs[i] === undefined),
      });
    })
    .catch((e) => {
      logWarn("catalog.warm.fail", {
        elapsedMs: Date.now() - started,
        error: e instanceof Error ? e.message : String(e),
      });
    });
}

/** `prev` is the copy in hand: its validators make an unchanged catalog a bodiless 304. */
async function loadCatalog(network: NetworkId, correlationId?: string, prev?: Fetched): Promise<Fetched | undefined> {
  const requests = staticRequests(`${networkPath(network)}/assets.mainnet.json`);
  if (requests.length === 0) {
    logWarn("catalog.no_url", { correlationId, network });
    return undefined;
  }
  const started = Date.now();
  const race = new AbortController();
  try {
    return await new Promise<Fetched | undefined>((resolve) => {
      let next = 0;
      let running = 0;
      let done = false;
      let hedge: NodeJS.Timeout | undefined;
      const finish = (fetched: Fetched | undefined) => {
        done = true;
        clearTimeout(hedge);
        resolve(fetched);
      };
      const launch = () => {
        clearTimeout(hedge);
        if (done) return;
        if (next >= requests.length) {
          if (running === 0) finish(undefined);
          return;
        }
        const req = requests[next++];
        running++;
        hedge = setTimeout(launch, HEDGE_MS);
        hedge.unref?.();
        downloadCatalog(req, race.signal, prev).then(
          (fetched) => {
            running--;
            markStaticHostOk(req.base);
            if (done) return;
            logInfo("catalog.ok", {
              correlationId,
              network,
              host: req.base,
              assets: fetched.doc.assets?.length ?? 0,
              notModified: fetched.doc === prev?.doc,
              elapsedMs: Date.now() - started,
            });
            finish(fetched);
          },
          (e: CatalogFetchError) => {
            running--;
            if (done) return;
            if (e.status === undefined) markStaticHostDown(req.base);
            logWarn("catalog.fail", { correlationId, network, host: req.base, error: e.message });
            launch();
          },
        );
      };
      launch();
    });
  } finally {
    race.abort();
  }
}

interface CatalogFetchError extends Error {
  /** HTTP status, or the status of a 200 that is not a catalog; absent when the host did not answer. */
  status?: number;
}

/**
 * One host: HEADERS_TIMEOUT_MS until the response starts, then BODY_TIMEOUT_MS
 * for the JSON. A 304 to `prev`'s validators returns `prev` itself.
 */
async function downloadCatalog(req: StaticRequest, race: AbortSignal, prev?: Fetched): Promise<Fetched> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  race.addEventListener("abort", abort, { once: true });
  let phase: "headers" | "body" = "headers";
  let timer = setTimeout(abort, HEADERS_TIMEOUT_MS);
  const headers: Record<string, string> = { ...req.headers };
  // Cloudflare answers If-None-Match with a full 200 (the weak ETag does not
  // survive compression), and a server that gets both ignores If-Modified-Since.
  if (prev?.lastModified) headers["If-Modified-Since"] = prev.lastModified;
  else if (prev?.etag) headers["If-None-Match"] = prev.etag;
  try {
    const res = await fetch(req.url, { headers, signal: controller.signal });
    clearTimeout(timer);
    const etag = validator(res.headers.get("etag"));
    const lastModified = validator(res.headers.get("last-modified"));
    if (res.status === 304 && prev) {
      void res.body?.cancel().catch(() => undefined);
      return { doc: prev.doc, etag: etag ?? prev.etag, lastModified: lastModified ?? prev.lastModified };
    }
    if (!res.ok) {
      void res.body?.cancel().catch(() => undefined);
      throw Object.assign(new Error(`HTTP ${res.status} for GET ${req.url}`), { status: res.status });
    }
    phase = "body";
    timer = setTimeout(abort, BODY_TIMEOUT_MS);
    const doc: unknown = await res.json();
    if (!isCatalog(doc)) throw Object.assign(new Error(`Not an asset catalog: GET ${req.url}`), { status: res.status });
    return { doc, etag, lastModified };
  } catch (e) {
    if (controller.signal.aborted && !race.aborted) {
      const ms = phase === "headers" ? HEADERS_TIMEOUT_MS : BODY_TIMEOUT_MS;
      throw new Error(`No ${phase} after ${ms}ms for GET ${req.url}`);
    }
    if (e instanceof SyntaxError) throw Object.assign(new Error(`Invalid JSON: GET ${req.url}`), { status: 200 });
    if (e instanceof TypeError) {
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      throw new Error(`Network error for GET ${req.url}: ${cause?.code ?? cause?.message ?? e.message}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
    race.removeEventListener("abort", abort);
  }
}

function validDecimals(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 36;
}

/**
 * Active catalog entries as manager assets, native coin first. The native
 * coin is always present (synthesized when the catalog is missing), so a
 * wallet still shows its main balance while the CDN is down. Pure, for tests.
 */
export function catalogAssets(network: NetworkId, doc: AssetCatalogDocument | undefined): Asset[] {
  const out: Asset[] = [];
  const seen = new Set<string>();
  for (const a of doc?.assets ?? []) {
    if (a.status !== undefined && a.status !== "active") continue;
    if (!a.asset_id || !/^[A-Za-z0-9_-]{1,64}$/.test(a.asset_id) || seen.has(a.asset_id)) continue;
    const native = !a.address;
    const decimals = native ? NATIVE_DECIMALS[network] : a.decimals;
    if (!validDecimals(decimals)) continue;
    if (native && out.some((x) => x.address === null)) continue;
    seen.add(a.asset_id);
    const symbol = (a.symbol ?? "").trim().toUpperCase() || "?";
    out.push({
      network,
      assetId: a.asset_id,
      symbol,
      name: a.name?.trim() || symbol,
      address: native ? null : a.address!.trim(),
      decimals,
      displayDecimals: validDecimals(a.displayDecimals) ? Math.min(a.displayDecimals, 8) : 4,
      externalId: a.externalId || undefined,
      isDefault: native || a.default === true,
      logoUri: a.logoUri,
      standard: native ? undefined : a.type || undefined,
    });
  }
  const nativeIndex = out.findIndex((x) => x.address === null);
  if (nativeIndex > 0) out.unshift(...out.splice(nativeIndex, 1));
  if (nativeIndex < 0) {
    out.unshift({
      network,
      assetId: NATIVE_ASSET_ID,
      symbol: NATIVE_SYMBOL[network],
      name: NETWORK_LABEL[network],
      address: null,
      decimals: NATIVE_DECIMALS[network],
      displayDecimals: 4,
      isDefault: true,
    });
  }
  return out;
}

export async function networkAssets(network: NetworkId, correlationId?: string): Promise<Asset[]> {
  return catalogAssets(network, await fetchCatalog(network, correlationId));
}

export function assetKey(asset: { network: string; assetId: string }): string {
  return `${asset.network}:${asset.assetId}`;
}

/** Path of an asset icon under a static base (see `staticRequests`), or null for odd `logoUri`s. */
export function assetIconPath(asset: Asset): string | null {
  const uri = asset.logoUri?.replace(/^\//, "");
  if (!uri || !/^assets\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}\.(png|jpe?g|webp)$/i.test(uri)) return null;
  return `${networkPath(asset.network)}/${uri}`;
}
