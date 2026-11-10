/**
 * `/api/wallets/:id/portfolio` and `/api/wallets/:id/tokens*`: balances,
 * USD values and token visibility. Visibility is a manager display setting;
 * `list_wallets` / `get_balance` are unaffected.
 */

import type { IncomingMessage } from "node:http";
import { formatUnits } from "ethers";
import { assetIconPath, assetKey, isNetworkId, networkAssets, type Asset } from "../api/catalog.js";
import { cachedNetworkBalances, type BalanceMap } from "../api/portfolio.js";
import { getUsdQuotes, lastUsdQuotes, type UsdQuote } from "../api/rates.js";
import type { WalletEntry } from "../keystore/types.js";
import { logInfo } from "../log.js";
import { ALL_NETWORKS, type NetworkId } from "../networks.js";
import { HttpError, readJson } from "./api-util.js";
import { findWallet } from "./api-wallets.js";
import type {
  NetworkError,
  PortfolioResponse,
  TokensResponse,
  TokenView,
  TokenVisibilityResponse,
} from "./contract.js";
import { readPrefs, setTokenVisibility } from "./prefs.js";

const TOKENS_LIMIT = 100;
const NETWORK_ERROR = "Balances on this network are not available right now.";

type VisibilityFlags = Record<string, boolean>;

function visibilityFlags(walletId: string): VisibilityFlags {
  return readPrefs().tokenVisibility?.[walletId] ?? {};
}

function isVisible(flags: VisibilityFlags, asset: Asset): boolean {
  return flags[assetKey(asset)] ?? asset.isDefault;
}

function formatBalance(raw: bigint, decimals: number): string {
  return formatUnits(raw, decimals).replace(/\.0$/, "");
}

function view(asset: Asset, raw: bigint | undefined, quote: UsdQuote | undefined): TokenView {
  const balance = raw === undefined ? null : formatBalance(raw, asset.decimals);
  return {
    key: assetKey(asset),
    network: asset.network,
    assetId: asset.assetId,
    symbol: asset.symbol,
    name: asset.name,
    standard: asset.standard ?? null,
    address: asset.address,
    decimals: asset.decimals,
    displayDecimals: asset.displayDecimals,
    balance,
    usdPrice: quote?.value ?? null,
    change24h: quote?.dailyChange ?? null,
    usdValue: balance !== null && quote ? Number(balance) * quote.value : null,
    icon: assetIconPath(asset) ? `icons/${asset.network}/${encodeURIComponent(asset.assetId)}` : null,
  };
}

/**
 * How long a request waits for the catalog, balances and USD rates together.
 * Networks still loading after that are answered as `pending`, rates as
 * `ratesPending` with the last known quotes; the reads go on in the shared
 * caches, so the next request picks up the result instead of starting over.
 */
const PARTIAL_WAIT_MS = 3000;
let partialWaitMs = PARTIAL_WAIT_MS;

/** Test hook. */
export function setPartialWaitMs(ms: number = PARTIAL_WAIT_MS): void {
  partialWaitMs = ms;
}

const PENDING = Symbol("pending");

interface NetworkState {
  network: NetworkId;
  catalog: Asset[];
  visible: Asset[];
  balances: BalanceMap | null;
  pending: boolean;
}

async function loadNetwork(
  entry: WalletEntry,
  flags: VisibilityFlags,
  network: NetworkId,
  deadline: Promise<typeof PENDING>,
  refresh: boolean,
): Promise<NetworkState> {
  const catalog = await Promise.race([networkAssets(network), deadline]);
  if (catalog === PENDING) return { network, catalog: [], visible: [], balances: null, pending: true };
  const visible = catalog.filter((a) => isVisible(flags, a));
  const owner = entry.addresses[network];
  if (!owner) return { network, catalog, visible, balances: null, pending: false };
  const read = cachedNetworkBalances(network, owner, visible, catalog, refresh).catch(() => null);
  const balances = await Promise.race([read, deadline]);
  return balances === PENDING
    ? { network, catalog, visible, balances: null, pending: true }
    : { network, catalog, visible, balances, pending: false };
}

/** Runs `fn` with a promise that resolves to PENDING once the partial wait is over. */
async function withDeadline<T>(fn: (deadline: Promise<typeof PENDING>) => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<typeof PENDING>((resolve) => {
    timer = setTimeout(() => resolve(PENDING), partialWaitMs);
    timer.unref?.();
  });
  try {
    return await fn(deadline);
  } finally {
    clearTimeout(timer);
  }
}

function loadNetworks(
  entry: WalletEntry,
  flags: VisibilityFlags,
  networks: NetworkId[],
  deadline: Promise<typeof PENDING>,
  refresh = false,
): Promise<NetworkState[]> {
  return Promise.all(networks.map((n) => loadNetwork(entry, flags, n, deadline, refresh)));
}

function walletNetworks(entry: WalletEntry): NetworkId[] {
  return ALL_NETWORKS.filter((n) => entry.addresses[n]);
}

function networkErrors(states: NetworkState[]): NetworkError[] {
  return states
    .filter((s) => s.balances === null && !s.pending)
    .map((s) => ({ network: s.network, message: NETWORK_ERROR }));
}

function pendingNetworks(states: NetworkState[]): NetworkId[] {
  return states.filter((s) => s.pending).map((s) => s.network);
}

interface Quotes {
  quotes: Map<string, UsdQuote>;
  ratesPending: boolean;
}

/** Fresh quotes if they come before the deadline, else the last known ones. */
async function quotesFor(assets: Asset[], deadline: Promise<typeof PENDING>): Promise<Quotes> {
  const ids = assets.map((a) => a.externalId).filter((id): id is string => !!id);
  const fresh = await Promise.race([getUsdQuotes(ids), deadline]);
  return fresh === PENDING ? { quotes: lastUsdQuotes(ids), ratesPending: true } : { quotes: fresh, ratesPending: false };
}

/** `?refresh=1` (the Refresh Balances button) reads every network again instead of the 30s cache. */
export async function walletPortfolio(id: string, params: URLSearchParams): Promise<PortfolioResponse> {
  const entry = findWallet(id);
  const started = Date.now();
  const flags = visibilityFlags(id);
  const refresh = params.get("refresh") === "1";
  const { states, quotes, ratesPending } = await withDeadline(async (deadline) => {
    const states = await loadNetworks(entry, flags, walletNetworks(entry), deadline, refresh);
    return { states, ...(await quotesFor(states.flatMap((s) => s.visible), deadline)) };
  });
  const tokens = states.flatMap((s) =>
    s.visible.map((a) => view(a, s.balances?.get(a.assetId), a.externalId ? quotes.get(a.externalId) : undefined)),
  );
  const totalUsd = tokens.reduce((sum, t) => sum + (t.usdValue ?? 0), 0);
  const errors = networkErrors(states);
  const pending = pendingNetworks(states);
  logInfo("manager.portfolio.ok", {
    name: entry.name,
    refresh,
    tokens: tokens.length,
    failedNetworks: errors.map((e) => e.network),
    pendingNetworks: pending,
    ratesPending,
    elapsedMs: Date.now() - started,
  });
  return { walletId: id, tokens, totalUsd, errors, pending, ratesPending };
}

function matches(asset: Asset, q: string): boolean {
  if (!q) return true;
  return (
    asset.symbol.toLowerCase().includes(q) ||
    asset.name.toLowerCase().includes(q) ||
    (asset.address !== null && asset.address.toLowerCase() === q)
  );
}

/**
 * Catalog entries for the Tokens screen: shown tokens first, then tokens with
 * a balance, then the catalog defaults, then the rest in catalog order.
 */
export async function walletTokens(id: string, params: URLSearchParams): Promise<TokensResponse> {
  const entry = findWallet(id);
  const requested = (params.get("network") ?? "").split(",").filter(Boolean);
  if (!requested.every(isNetworkId)) throw new HttpError(400, "bad_request", "Unknown network.");
  const q = (params.get("q") ?? "").trim().toLowerCase().slice(0, 100);
  const networks = walletNetworks(entry).filter((n) => requested.length === 0 || requested.includes(n));
  const flags = visibilityFlags(id);
  const { states, rows, page, quotes, ratesPending } = await withDeadline(async (deadline) => {
    const states = await loadNetworks(entry, flags, networks, deadline);
    const rows = states.flatMap((s) =>
      s.catalog
        .filter((a) => matches(a, q))
        .map((asset, order) => {
          const visible = s.visible.includes(asset);
          const raw = s.balances?.get(asset.assetId);
          const rank = visible ? 0 : raw !== undefined && raw > 0n ? 1 : asset.isDefault ? 2 : 3;
          return { asset, raw, visible, rank, order };
        }),
    );
    rows.sort((a, b) => a.rank - b.rank || a.order - b.order);
    const page = rows.slice(0, TOKENS_LIMIT);
    const funded = page.filter((r) => r.raw !== undefined && r.raw > 0n).map((r) => r.asset);
    return { states, rows, page, ...(await quotesFor(funded, deadline)) };
  });
  return {
    tokens: page.map((r) => ({
      ...view(r.asset, r.raw, r.asset.externalId ? quotes.get(r.asset.externalId) : undefined),
      visible: r.visible,
    })),
    total: rows.length,
    errors: networkErrors(states),
    pending: pendingNetworks(states),
    ratesPending,
  };
}

export async function setWalletTokenVisibility(
  req: IncomingMessage,
  id: string,
  network: string,
  assetId: string,
): Promise<TokenVisibilityResponse> {
  const entry = findWallet(id);
  const { visible } = await readJson(req);
  if (typeof visible !== "boolean") throw new HttpError(400, "bad_request", '"visible" must be true or false.');
  if (!isNetworkId(network)) throw new HttpError(404, "not_found", "Unknown network.");
  const asset = (await networkAssets(network)).find((a) => a.assetId === assetId);
  if (!asset) throw new HttpError(404, "not_found", "Unknown token.");
  setTokenVisibility(id, assetKey(asset), visible, asset.isDefault);
  logInfo("manager.token_visibility.ok", { name: entry.name, key: assetKey(asset), visible });
  return { key: assetKey(asset), visible };
}
