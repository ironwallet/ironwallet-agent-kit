/**
 * USD rates for policy limits (`maxPerTxUsd`).
 *
 * Same backend the mobile app uses:
 *   GET {ratesApiUrl}/api/v1/rate/rates?Ids=<externalId,...>&Currencies=usd
 * `Ids` are catalog `externalId`s (CoinGecko-style: "ethereum", "tether"), not
 * symbols or contracts. Native coins map statically; tokens are resolved via the
 * public static asset catalog
 *   GET {staticResourcesUrl}/assets/main/blockchains/<net>/assets.mainnet.json
 * matched by contract address (symbol as fallback).
 *
 * Callers must fail closed: `undefined` means "no rate", never "skip the check".
 */

import { getConfig } from "../config.js";
import type { NetworkId } from "../networks.js";
import { logInfo, logWarn } from "../log.js";
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

/** Networks with a token catalog on static resources (litecoin/doge are native-only). */
const CATALOG_NETWORKS: readonly NetworkId[] = [
  "ethereum",
  "bsc",
  "polygon",
  "base",
  "arbitrum",
  "optimism",
  "avalanche",
  "tron",
  "bitcoin",
  "solana",
  "ton",
  "xrp",
];

export interface CatalogAsset {
  symbol?: string;
  address?: string;
  externalId?: string;
}

export interface AssetCatalogDocument {
  assets?: CatalogAsset[];
}

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

const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
const RATE_TTL_MS = 60 * 1000;

/**
 * Keep the policy check snappy: a send/swap should not hang for minutes when
 * the rates backend is down — it will be rejected (fail closed) anyway.
 */
const FETCH_OPTS = { timeoutMs: 10000, retries: 1 } as const;

const catalogCache = new Map<NetworkId, { at: number; doc: AssetCatalogDocument }>();
const rateCache = new Map<string, { at: number; value: number }>();

/** Test hook. */
export function clearRatesCaches(): void {
  catalogCache.clear();
  rateCache.clear();
}

async function fetchCatalog(
  network: NetworkId,
  correlationId?: string,
): Promise<AssetCatalogDocument | undefined> {
  const cached = catalogCache.get(network);
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached.doc;
  const cfg = getConfig();
  if (!cfg.staticResourcesUrl) {
    logWarn("rates.catalog.no_url", { correlationId, network });
    return undefined;
  }
  const url = `${cfg.staticResourcesUrl}/assets/main/blockchains/${network}/assets.mainnet.json`;
  try {
    const doc = await httpJson<AssetCatalogDocument>(
      url,
      { method: "GET" },
      { correlationId, label: "rates.catalog", ...FETCH_OPTS },
    );
    catalogCache.set(network, { at: Date.now(), doc });
    logInfo("rates.catalog.ok", {
      correlationId,
      network,
      assets: doc.assets?.length ?? 0,
    });
    return doc;
  } catch (e) {
    logWarn("rates.catalog.fail", {
      correlationId,
      network,
      error: e instanceof Error ? e.message : String(e),
    });
    return undefined;
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
  if (!CATALOG_NETWORKS.includes(asset.network)) return undefined;
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

  const cached = rateCache.get(externalId);
  if (cached && Date.now() - cached.at < RATE_TTL_MS) return cached.value;

  const cfg = getConfig();
  if (!cfg.ratesApiUrl) {
    logWarn("rates.usd.no_url", { correlationId, externalId });
    return undefined;
  }
  const url =
    `${cfg.ratesApiUrl}/api/v1/rate/rates` +
    `?Ids=${encodeURIComponent(externalId)}&Currencies=usd`;
  let response: RatesResponse;
  try {
    response = await httpJson<RatesResponse>(
      url,
      { method: "GET" },
      { correlationId, label: "rates.usd", ...FETCH_OPTS },
    );
  } catch (e) {
    logWarn("rates.usd.fetch_fail", {
      correlationId,
      externalId,
      error: e instanceof Error ? e.message : String(e),
    });
    return undefined;
  }

  const rate = parseUsdRate(response ?? {}, externalId);
  if (!rate) {
    logWarn("rates.usd.missing", { correlationId, externalId });
    return undefined;
  }
  if (rate.isExpired) {
    logWarn("rates.usd.expired", { correlationId, externalId, value: rate.value });
  }
  rateCache.set(externalId, { at: Date.now(), value: rate.value });
  logInfo("rates.usd.ok", { correlationId, externalId, value: rate.value });
  return rate.value;
}
