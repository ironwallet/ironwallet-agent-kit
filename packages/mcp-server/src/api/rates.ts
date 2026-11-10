/**
 * USD rates for policy limits (`maxPerTxUsd`) and the wallet manager's balances.
 *
 * Same backend the mobile app uses:
 *   GET {ratesApiUrl}/api/v1/rate/rates?Ids=<externalId,...>&Currencies=usd
 * `Ids` are catalog `externalId`s (CoinGecko-style: "ethereum", "tether"), not
 * symbols or contracts. Native coins map statically; tokens are resolved via the
 * public static asset catalog (see catalog.ts) matched by contract address
 * (symbol as fallback).
 *
 * Callers must fail closed: `undefined` means "no rate", never "skip the check".
 */

import { commonHeaders, getConfig } from "../config.js";
import type { NetworkId } from "../networks.js";
import { logInfo, logWarn } from "../log.js";
import { clearCatalogCache, fetchCatalog, type AssetCatalogDocument } from "./catalog.js";
import { httpJson } from "./http.js";

/** Verified against the mobile app's asset catalogs (init_assets_data). */
export const NATIVE_EXTERNAL_ID: Record<NetworkId, string> = {
  ethereum: "ethereum",
  bsc: "binancecoin",
  polygon: "polygon-ecosystem-token",
  base: "ethereum",
  arbitrum: "ethereum",
  optimism: "ethereum",
  avalanche: "avalanche-2",
  tron: "tron",
  bitcoin: "bitcoin",
  litecoin: "litecoin",
  doge: "dogecoin",
  solana: "solana",
  ton: "the-open-network",
  xrp: "ripple",
};

/** Hex (EVM) contracts compare case-insensitively; base58 chains compare exactly. */
export function sameTokenAddress(a: string, b: string): boolean {
  const ta = a.trim();
  const tb = b.trim();
  if (ta === tb) return true;
  if (ta.startsWith("0x") && tb.startsWith("0x")) {
    return ta.toLowerCase() === tb.toLowerCase();
  }
  return false;
}

/** Find a token's externalId in a static catalog document. Pure, for tests. */
export function findExternalIdInCatalog(
  doc: AssetCatalogDocument,
  query: { symbol?: string; tokenAddress?: string },
): string | undefined {
  const assets = doc.assets ?? [];
  if (query.tokenAddress) {
    const byAddress = assets.find(
      (a) => a.address && sameTokenAddress(a.address, query.tokenAddress!),
    );
    if (byAddress?.externalId) return byAddress.externalId;
  }
  if (query.symbol) {
    const want = query.symbol.trim().toLowerCase();
    const bySymbol = assets.find(
      (a) => !a.address && a.symbol?.trim().toLowerCase() === want,
    );
    if (bySymbol?.externalId) return bySymbol.externalId;
  }
  return undefined;
}

/** Response shape of GET /api/v1/rate/rates (keys are externalIds). */
export type RatesResponse = Record<
  string,
  Record<string, { value?: number; dailyChange?: number; isExpired?: boolean }> | null
>;

/** Extract a positive USD rate from the backend response. Pure, for tests. */
export function parseUsdRate(
  response: RatesResponse,
  externalId: string,
): { value: number; isExpired: boolean } | undefined {
  const perCurrency = response[externalId];
  if (!perCurrency) return undefined;
  const usdKey = Object.keys(perCurrency).find((k) => k.toLowerCase() === "usd");
  if (!usdKey) return undefined;
  const rate = perCurrency[usdKey];
  if (!rate || typeof rate.value !== "number" || !(rate.value > 0)) return undefined;
  return { value: rate.value, isExpired: rate.isExpired === true };
}

/** 24h change in percent (`-1.2` = −1.2%), as the mobile app shows it. */
export function parseDailyChange(response: RatesResponse, externalId: string): number | null {
  const perCurrency = response[externalId];
  if (!perCurrency) return null;
  const usdKey = Object.keys(perCurrency).find((k) => k.toLowerCase() === "usd");
  const change = usdKey ? perCurrency[usdKey]?.dailyChange : undefined;
  return typeof change === "number" && Number.isFinite(change) ? change : null;
}

const RATE_TTL_MS = 60 * 1000;
/** Ids per request: keeps the query string well under common URL limits. */
const RATE_BATCH = 100;

/**
 * Keep the policy check snappy: a send/swap should not hang for minutes when
 * the rates backend is down — it will be rejected (fail closed) anyway.
 */
const FETCH_OPTS = { timeoutMs: 10000, retries: 1 } as const;

export interface UsdQuote {
  value: number;
  /** Percent; null when the backend does not report it. */
  dailyChange: number | null;
}

const rateCache = new Map<string, { at: number; quote: UsdQuote }>();
/** One request per id at a time: concurrent callers wait for the same batch. */
const rateInflight = new Map<string, Promise<void>>();

/** Test hook. */
export function clearRatesCaches(): void {
  clearCatalogCache();
  rateCache.clear();
  rateInflight.clear();
}

/** Test hook: every cached quote is due for a refetch but still known. */
export function expireRatesCache(): void {
  for (const entry of rateCache.values()) entry.at = 0;
}

function freshQuote(id: string): UsdQuote | undefined {
  const cached = rateCache.get(id);
  return cached && Date.now() - cached.at < RATE_TTL_MS ? cached.quote : undefined;
}

/**
 * Last quotes ever received, however old. Display only (the wallet manager
 * while a refetch is slow); policy checks must use `getUsdQuotes`.
 */
export function lastUsdQuotes(externalIds: readonly string[]): Map<string, UsdQuote> {
  const out = new Map<string, UsdQuote>();
  for (const id of externalIds) {
    const cached = rateCache.get(id);
    if (cached) out.set(id, cached.quote);
  }
  return out;
}

/**
 * USD quotes for many `externalId`s at once (one request per 100 ids).
 * Unknown ids and failed batches are simply absent from the result.
 */
export async function getUsdQuotes(
  externalIds: readonly string[],
  correlationId?: string,
): Promise<Map<string, UsdQuote>> {
  const out = new Map<string, UsdQuote>();
  const missing: string[] = [];
  for (const id of new Set(externalIds)) {
    const quote = freshQuote(id);
    if (quote) out.set(id, quote);
    else missing.push(id);
  }
  if (missing.length === 0) return out;
  const cfg = getConfig();
  if (!cfg.ratesApiUrl) {
    logWarn("rates.usd.no_url", { correlationId, ids: missing.length });
    return out;
  }
  const waits = new Set<Promise<void>>();
  const toFetch: string[] = [];
  for (const id of missing) {
    const pending = rateInflight.get(id);
    if (pending) waits.add(pending);
    else toFetch.push(id);
  }
  for (let i = 0; i < toFetch.length; i += RATE_BATCH) {
    const ids = toFetch.slice(i, i + RATE_BATCH);
    const run = fetchQuotes(ids, cfg, correlationId).finally(() => {
      for (const id of ids) if (rateInflight.get(id) === run) rateInflight.delete(id);
    });
    for (const id of ids) rateInflight.set(id, run);
    waits.add(run);
  }
  await Promise.all(waits);
  for (const id of missing) {
    const quote = freshQuote(id);
    if (quote) out.set(id, quote);
  }
  return out;
}

/** One rates request; results land in the cache, failures are logged and dropped. */
async function fetchQuotes(
  ids: string[],
  cfg: ReturnType<typeof getConfig>,
  correlationId: string | undefined,
): Promise<void> {
  const url =
    `${cfg.ratesApiUrl}/api/v1/rate/rates` +
    `?Ids=${ids.map(encodeURIComponent).join(",")}&Currencies=usd`;
  let response: RatesResponse;
  try {
    response = await httpJson<RatesResponse>(
      url,
      { method: "GET", headers: commonHeaders(cfg) },
      { correlationId, label: "rates.usd", ...FETCH_OPTS },
    );
  } catch (e) {
    logWarn("rates.usd.fetch_fail", {
      correlationId,
      ids: ids.length,
      error: e instanceof Error ? e.message : String(e),
    });
    return;
  }
  for (const id of ids) {
    const rate = parseUsdRate(response ?? {}, id);
    if (!rate) continue;
    if (rate.isExpired) logWarn("rates.usd.expired", { correlationId, externalId: id, value: rate.value });
    rateCache.set(id, { at: Date.now(), quote: { value: rate.value, dailyChange: parseDailyChange(response ?? {}, id) } });
  }
}

/**
 * Resolve the rates id for an asset. Native coins come from the static map;
 * tokens are looked up in the network's asset catalog by contract address.
 */
export async function resolveExternalId(
  asset: { network: NetworkId; symbol?: string; tokenAddress?: string },
  correlationId?: string,
): Promise<string | undefined> {
  if (!asset.tokenAddress) return NATIVE_EXTERNAL_ID[asset.network];
  const doc = await fetchCatalog(asset.network, correlationId);
  if (!doc) return undefined;
  return findExternalIdInCatalog(doc, {
    symbol: asset.symbol,
    tokenAddress: asset.tokenAddress,
  });
}

/**
 * USD price for one asset unit, or `undefined` when the asset or its rate is
 * unknown / the backend is unreachable. Cached for ~60s per externalId.
 */
export async function getUsdRate(
  asset: { network: NetworkId; symbol?: string; tokenAddress?: string },
  correlationId?: string,
): Promise<number | undefined> {
  const externalId = await resolveExternalId(asset, correlationId);
  if (!externalId) {
    logWarn("rates.usd.no_external_id", {
      correlationId,
      network: asset.network,
      symbol: asset.symbol,
      tokenAddress: asset.tokenAddress,
    });
    return undefined;
  }

  const quote = (await getUsdQuotes([externalId], correlationId)).get(externalId);
  if (!quote) {
    logWarn("rates.usd.missing", { correlationId, externalId });
    return undefined;
  }
  logInfo("rates.usd.ok", { correlationId, externalId, value: quote.value });
  return quote.value;
}
