/**
 * Swap HTTP client — matches the mobile client:
 *   /swp/refs/*  discovery
 *   /swp/exchange/*  estimate → create → execute → status
 *
 * Auth: IWB Bearer + device headers (same as relay). Not the transfer relay.
 */

import { getConfig } from "../config.js";
import { authHeaders } from "./auth.js";
import { httpJson, type HttpError } from "./http.js";
import { logError, logInfo, newCorrelationId } from "../log.js";

export interface SwapAsset {
  network: string;
  symbol: string;
  address?: string | null;
  decimals: number;
}

export interface SwapSide {
  asset: SwapAsset;
  address: string;
  amount?: string;
}

export interface SwapCallOpts {
  correlationId?: string;
}

export interface SwapApiError {
  code?: number;
  reason?: string;
  traceId?: string;
  raw?: unknown;
}

export class SwapError extends Error {
  readonly code?: number;
  readonly traceId?: string;
  readonly raw?: unknown;

  constructor(message: string, info: SwapApiError = {}) {
    super(message);
    this.name = "SwapError";
    this.code = info.code;
    this.traceId = info.traceId;
    this.raw = info.raw;
  }
}

function capitalizeNetwork(name: string): string {
  const t = name.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/** SwapKit tickers are uppercase (`USDT`). SWP catalog symbols are not (`usdt`, `USDt`). */
function canonicalSwapSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function assetToJson(asset: SwapAsset): Record<string, unknown> {
  const body: Record<string, unknown> = {
    network: asset.network.toLowerCase(),
    symbol: canonicalSwapSymbol(asset.symbol),
    decimals: asset.decimals,
  };
  if (asset.address) body.address = asset.address;
  return body;
}

function sideToJson(side: SwapSide): Record<string, unknown> {
  const body: Record<string, unknown> = {
    asset: assetToJson(side.asset),
    address: side.address,
  };
  if (side.amount !== undefined) body.amount = side.amount;
  return body;
}

function parseSwapError(body: string | undefined, fallback: string): SwapError {
  if (!body) return new SwapError(fallback);
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const errors = json.errors;
    const first =
      Array.isArray(errors) && errors[0] && typeof errors[0] === "object"
        ? (errors[0] as Record<string, unknown>)
        : json;
    const codeRaw = first.code ?? json.status;
    const code =
      typeof codeRaw === "number"
        ? codeRaw
        : typeof codeRaw === "string"
          ? Number.parseInt(codeRaw, 10)
          : undefined;
    const reason =
      (typeof first.reason === "string" && first.reason) ||
      (typeof json.title === "string" && json.title) ||
      fallback;
    const traceId = typeof json.traceId === "string" ? json.traceId : undefined;
    const msg =
      code !== undefined && Number.isFinite(code)
        ? `Swap API error ${code}: ${reason}`
        : `Swap API error: ${reason}`;
    return new SwapError(msg, { code, reason, traceId, raw: json });
  } catch {
    return new SwapError(`${fallback}: ${body.slice(0, 300)}`);
  }
}

async function swpJson<T>(
  path: string,
  init: {
    method: string;
    headers?: Record<string, string>;
    body?: string;
  },
  opts: SwapCallOpts & { label: string; retry?: boolean; timeoutMs?: number },
): Promise<T> {
  const cfg = getConfig();
  const url = `${cfg.swapProxyUrl.replace(/\/$/, "")}${path}`;
  const correlationId = opts.correlationId ?? newCorrelationId("swp");
  try {
    return await httpJson<T>(url, init, {
      correlationId,
      label: opts.label,
      retry: opts.retry,
      timeoutMs: opts.timeoutMs,
    });
  } catch (e) {
    const err = e as HttpError;
    if (err && typeof err.status === "number") {
      throw parseSwapError(err.body, err.message);
    }
    throw e;
  }
}

function assertNoError(json: Record<string, unknown>, label: string): void {
  const errors = json.errors;
  const hasErrors = Array.isArray(errors)
    ? errors.length > 0
    : Boolean(errors);
  if (json.error || hasErrors) {
    throw parseSwapError(JSON.stringify(json), `${label} returned an error`);
  }
}

export interface SwapNetworkItem {
  id?: number;
  name: string;
  decimals?: number;
}

export async function listSwapNetworks(
  token: string,
  opts: SwapCallOpts = {},
): Promise<SwapNetworkItem[]> {
  const correlationId = opts.correlationId ?? newCorrelationId("swp-net");
  logInfo("swap.networks.start", { correlationId });
  try {
    const json = await swpJson<Record<string, unknown>>(
      "/swp/refs/networks",
      {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      { correlationId, label: "swap.networks", retry: true },
    );
    assertNoError(json, "list_swap_networks");
    const items = (json.items as Array<Record<string, unknown>> | undefined) ?? [];
    const result = items.map((i) => ({
      id: typeof i.id === "number" ? i.id : undefined,
      name: String(i.name ?? ""),
      decimals: typeof i.decimals === "number" ? i.decimals : undefined,
    }));
    logInfo("swap.networks.ok", { correlationId, count: result.length });
    return result;
  } catch (e) {
    logError("swap.networks.fail", e, { correlationId });
    throw e;
  }
}

export interface SwapAssetsPage {
  items: SwapAsset[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listSwapAssetsFrom(
  token: string,
  params: {
    search?: string;
    page?: number;
    pageSize?: number;
    networks?: string[];
  } = {},
  opts: SwapCallOpts = {},
): Promise<SwapAssetsPage> {
  const correlationId = opts.correlationId ?? newCorrelationId("swp-af");
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 50;
  const payload: Record<string, unknown> = {};
  if (params.networks?.length) {
    payload.networks = params.networks.map(capitalizeNetwork);
  }
  const q = params.search?.trim();
  if (q) payload.findBySymbol = q;

  const json = await swpJson<Record<string, unknown>>(
    "/swp/refs/assets/from",
    {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ page, pageSize, payload }),
    },
    { correlationId, label: "swap.assets.from", retry: true },
  );
  assertNoError(json, "list_swap_assets(from)");
  return parseAssetsPage(json, page, pageSize);
}

export async function listSwapAssetsTo(
  token: string,
  params: {
    from: Pick<SwapAsset, "network" | "symbol" | "address">;
    search?: string;
    page?: number;
    pageSize?: number;
    networks?: string[];
  },
  opts: SwapCallOpts = {},
): Promise<SwapAssetsPage> {
  const correlationId = opts.correlationId ?? newCorrelationId("swp-at");
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 50;
  const body: Record<string, unknown> = {
    page,
    pageSize,
    fromAsset: {
      network: capitalizeNetwork(params.from.network),
      symbol: canonicalSwapSymbol(params.from.symbol),
      ...(params.from.address ? { address: params.from.address } : {}),
    },
  };
  if (params.networks?.length) {
    body.toNetworks = params.networks.map(capitalizeNetwork);
  }
  const q = params.search?.trim();
  if (q) body.findBySymbol = q;

  const json = await swpJson<Record<string, unknown>>(
    "/swp/refs/assets/to",
    {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { correlationId, label: "swap.assets.to", retry: true },
  );
  assertNoError(json, "list_swap_assets(to)");
  return parseAssetsPage(json, page, pageSize);
}

function parseAssetsPage(
  json: Record<string, unknown>,
  page: number,
  pageSize: number,
): SwapAssetsPage {
  const raw = (json.items as Array<Record<string, unknown>> | undefined) ?? [];
  const items: SwapAsset[] = raw.map((i) => ({
    network: String(i.network ?? "").toLowerCase(),
    symbol: canonicalSwapSymbol(String(i.symbol ?? "")),
    decimals: Number(i.decimals ?? 0),
    address: i.address == null || i.address === "" ? null : String(i.address),
  }));
  return {
    items,
    total: typeof json.total === "number" ? json.total : items.length,
    page: typeof json.page === "number" ? json.page : page,
    pageSize: typeof json.pageSize === "number" ? json.pageSize : pageSize,
  };
}

export interface SwapEstimateResult {
  operationId: string;
  provider?: string;
  from: SwapSide & { amount?: string };
  to: SwapSide & { amount?: string };
  correctedAmountFrom?: string;
  correctedAmountTo?: string;
  details?: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export async function estimateSwap(
  token: string,
  params: { from: SwapSide; to: SwapSide; maxMode?: boolean },
  opts: SwapCallOpts = {},
): Promise<SwapEstimateResult> {
  const correlationId = opts.correlationId ?? newCorrelationId("swp-est");
  logInfo("swap.estimate.start", {
    correlationId,
    fromNetwork: params.from.asset.network,
    toNetwork: params.to.asset.network,
    fromSymbol: params.from.asset.symbol,
    toSymbol: params.to.asset.symbol,
    amount: params.from.amount,
    maxMode: Boolean(params.maxMode),
  });
  try {
    const json = await swpJson<Record<string, unknown>>(
      "/swp/exchange/estimate",
      {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          from: sideToJson(params.from),
          to: sideToJson(params.to),
          maxMode: Boolean(params.maxMode),
        }),
      },
      { correlationId, label: "swap.estimate", retry: true },
    );
    assertNoError(json, "estimate_swap");
    const result = mapEstimate(json);
    logInfo("swap.estimate.ok", {
      correlationId,
      operationId: result.operationId,
      correctedAmountFrom: result.correctedAmountFrom,
      amountTo: result.to.amount,
    });
    return result;
  } catch (e) {
    logError("swap.estimate.fail", e, { correlationId });
    throw e;
  }
}

function mapSide(raw: Record<string, unknown> | undefined): SwapSide & { amount?: string } {
  const assetRaw = (raw?.asset as Record<string, unknown> | undefined) ?? {};
  return {
    asset: {
      network: String(assetRaw.network ?? "").toLowerCase(),
      symbol: canonicalSwapSymbol(String(assetRaw.symbol ?? "")),
      decimals: Number(assetRaw.decimals ?? 0),
      address:
        assetRaw.address == null || assetRaw.address === ""
          ? null
          : String(assetRaw.address),
    },
    address: String(raw?.address ?? ""),
    amount: raw?.amount != null ? String(raw.amount) : undefined,
  };
}

function mapEstimate(json: Record<string, unknown>): SwapEstimateResult {
  return {
    operationId: String(json.operationId ?? ""),
    provider: json.provider != null ? String(json.provider) : undefined,
    from: mapSide(json.from as Record<string, unknown> | undefined),
    to: mapSide(json.to as Record<string, unknown> | undefined),
    correctedAmountFrom:
      json.correctedAmountFrom != null ? String(json.correctedAmountFrom) : undefined,
    correctedAmountTo:
      json.correctedAmountTo != null ? String(json.correctedAmountTo) : undefined,
    details: slimSwapDetails(
      (json.details as Record<string, unknown> | undefined) ?? undefined,
    ),
    raw: json,
  };
}

/** Agent-facing swap fees: tokenFee / coinFee only (no network fee). */
const SWAP_FEE_KEYS = ["tokenFee", "coinFee"] as const;

/** Provider extras that confuse agents and are not needed to execute a swap. */
const SWAP_DROP_KEYS = ["slippage", "slippagePercent", "slippageBps", "networkFee"] as const;

function omitDroppedKeys(src: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if ((SWAP_DROP_KEYS as readonly string[]).includes(k)) continue;
    out[k] = v;
  }
  return out;
}

function pickSwapFees(fees: unknown): Record<string, unknown> | undefined {
  if (!fees || typeof fees !== "object" || Array.isArray(fees)) return undefined;
  const src = fees as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of SWAP_FEE_KEYS) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function slimSwapDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const { fees, ...rest } = omitDroppedKeys(details);
  const slim = pickSwapFees(fees);
  const next = slim ? { ...rest, fees: slim } : rest;
  return Object.keys(next).length > 0 ? next : undefined;
}

export function slimSwapPayload(json: Record<string, unknown>): Record<string, unknown> {
  const next = omitDroppedKeys(json);
  if ("fees" in next) {
    const slim = pickSwapFees(next.fees);
    if (slim) next.fees = slim;
    else delete next.fees;
  }
  if (next.details && typeof next.details === "object" && !Array.isArray(next.details)) {
    const slim = slimSwapDetails(next.details as Record<string, unknown>);
    if (slim) next.details = slim;
    else delete next.details;
  }
  return next;
}

export interface SwapTxToSign {
  txId?: string;
  txData?: string;
  extraData?: string;
  type?: string;
}

export interface SwapCreateResult {
  operationId: string;
  swapOrderId: string;
  provider?: string;
  txsToSign: SwapTxToSign[];
  raw: Record<string, unknown>;
}

export async function createSwap(
  token: string,
  params: {
    operationId: string;
    correctedAmountFrom: string;
    from: SwapSide;
    to: SwapSide;
    maxMode?: boolean;
  },
  opts: SwapCallOpts = {},
): Promise<SwapCreateResult> {
  const correlationId = opts.correlationId ?? newCorrelationId("swp-crt");
  logInfo("swap.create.start", {
    correlationId,
    operationId: params.operationId,
    correctedAmountFrom: params.correctedAmountFrom,
  });
  try {
    const json = await swpJson<Record<string, unknown>>(
      "/swp/exchange/create",
      {
        method: "POST",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json",
          "x-idempotency-key": params.operationId,
        },
        body: JSON.stringify({
          operationId: params.operationId,
          correctedAmountFrom: params.correctedAmountFrom,
          from: sideToJson(params.from),
          to: sideToJson(params.to),
          maxMode: Boolean(params.maxMode),
        }),
      },
      // Create is not safely retryable after acceptance; keep default POST no-retry.
      { correlationId, label: "swap.create", retry: false },
    );
    assertNoError(json, "create_swap");
    const order = json.order as Record<string, unknown> | undefined;
    const txs =
      (json.txsToSign as Array<Record<string, unknown>> | undefined) ?? [];
    const result: SwapCreateResult = {
      operationId: String(json.operationId ?? params.operationId),
      swapOrderId: String(order?.uid ?? order?.id ?? ""),
      provider: json.provider != null ? String(json.provider) : undefined,
      txsToSign: txs.map((t) => ({
        txId: t.txId != null ? String(t.txId) : undefined,
        txData: t.txData != null ? String(t.txData) : undefined,
        extraData: t.extraData != null ? String(t.extraData) : undefined,
        type: t.type != null ? String(t.type) : undefined,
      })),
      raw: json,
    };
    logInfo("swap.create.ok", {
      correlationId,
      operationId: result.operationId,
      swapOrderId: result.swapOrderId,
      txCount: result.txsToSign.length,
    });
    return result;
  } catch (e) {
    logError("swap.create.fail", e, {
      correlationId,
      operationId: params.operationId,
    });
    throw e;
  }
}

export interface SwapSignedTxDto {
  type: string;
  signedTx: string;
  txData: string;
  txHash: string;
  txId: string;
}

export interface SwapExecuteResult {
  operationId: string;
  txHash?: string;
  raw: Record<string, unknown>;
}

export async function executeSwap(
  token: string,
  params: {
    operationId: string;
    swapOrderId: string;
    from: SwapSide;
    to: SwapSide;
    signedTransactions: SwapSignedTxDto[];
  },
  opts: SwapCallOpts = {},
): Promise<SwapExecuteResult> {
  const correlationId = opts.correlationId ?? newCorrelationId("swp-exe");
  const cfg = getConfig();
  logInfo("swap.execute.start", {
    correlationId,
    operationId: params.operationId,
    swapOrderId: params.swapOrderId,
    signedCount: params.signedTransactions.length,
  });
  try {
    const json = await swpJson<Record<string, unknown>>(
      "/swp/exchange/execute",
      {
        method: "POST",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json",
          "x-idempotency-key": params.operationId,
        },
        body: JSON.stringify({
          operationId: params.operationId,
          swapOrderId: params.swapOrderId,
          from: sideToJson(params.from),
          to: sideToJson(params.to),
          signedTransactions: params.signedTransactions,
        }),
      },
      {
        correlationId,
        label: "swap.execute",
        retry: false,
        timeoutMs: cfg.httpForwardTimeoutMs,
      },
    );
    assertNoError(json, "execute_swap");
    const result: SwapExecuteResult = {
      operationId: String(json.operationId ?? params.operationId),
      txHash:
        json.txHash != null
          ? String(json.txHash)
          : json.hash != null
            ? String(json.hash)
            : undefined,
      raw: json,
    };
    logInfo("swap.execute.ok", {
      correlationId,
      operationId: result.operationId,
      txHash: result.txHash,
    });
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const timedOut = /timed out/i.test(msg);
    logError("swap.execute.fail", e, {
      correlationId,
      operationId: params.operationId,
      timedOut,
      warning:
        "Swap may still be in progress. Poll get_swap_status before retrying.",
    });
    if (timedOut) {
      throw new Error(
        `${msg}. The swap may still be processing — call get_swap_status ` +
          `with operationId=${params.operationId} before retrying. ` +
          `[correlationId=${correlationId}]`,
      );
    }
    throw e;
  }
}

export async function getSwapStatus(
  token: string,
  operationId: string,
  opts: SwapCallOpts = {},
): Promise<Record<string, unknown>> {
  const correlationId = opts.correlationId ?? newCorrelationId("swp-st");
  const json = await swpJson<Record<string, unknown>>(
    `/swp/exchange/status/${encodeURIComponent(operationId)}`,
    {
      method: "GET",
      headers: authHeaders(token),
    },
    { correlationId, label: "swap.status", retry: true },
  );
  assertNoError(json, "get_swap_status");
  return slimSwapPayload(json);
}

/** SWP allows up to 200; keep under the cap while limiting round-trips. */
const RESOLVE_PAGE_SIZE = 100;
/** Hard stop so a broken `total` cannot loop forever (~5k assets). */
const RESOLVE_MAX_PAGES = 50;

function matchAsset(
  items: SwapAsset[],
  ref: { network: string; symbol: string; address?: string | null },
): SwapAsset | undefined {
  const wantNet = ref.network.toLowerCase();
  const wantSym = ref.symbol.toLowerCase();
  const wantAddr = (ref.address ?? "").toLowerCase();
  return items.find(
    (a) =>
      a.network === wantNet &&
      a.symbol.toLowerCase() === wantSym &&
      (a.address ?? "").toLowerCase() === wantAddr,
  );
}

/**
 * Same network + symbol, different contracts — used for a clear error when the
 * caller omitted `address` and the catalog is ambiguous.
 */
function sameSymbolOnNetwork(
  items: SwapAsset[],
  ref: { network: string; symbol: string },
): SwapAsset[] {
  const wantNet = ref.network.toLowerCase();
  const wantSym = ref.symbol.toLowerCase();
  return items.filter(
    (a) => a.network === wantNet && a.symbol.toLowerCase() === wantSym,
  );
}

async function findAssetAcrossPages(
  fetchPage: (page: number, pageSize: number) => Promise<SwapAssetsPage>,
  ref: { network: string; symbol: string; address?: string | null },
): Promise<{ match?: SwapAsset; scanned: number; ambiguous?: SwapAsset[] }> {
  let pageNum = 1;
  let total = Number.POSITIVE_INFINITY;
  let scanned = 0;
  const symbolHits: SwapAsset[] = [];
  const wantAddr = (ref.address ?? "").toLowerCase();

  while (pageNum <= RESOLVE_MAX_PAGES && scanned < total) {
    const page = await fetchPage(pageNum, RESOLVE_PAGE_SIZE);
    total = Number.isFinite(page.total) ? page.total : scanned + page.items.length;
    scanned += page.items.length;

    const hit = matchAsset(page.items, ref);
    if (hit) return { match: hit, scanned };

    // Track collisions only when caller did not pin a contract address.
    if (!wantAddr) {
      for (const a of sameSymbolOnNetwork(page.items, ref)) {
        const key = (a.address ?? "").toLowerCase();
        if (!symbolHits.some((x) => (x.address ?? "").toLowerCase() === key)) {
          symbolHits.push(a);
        }
      }
    }

    if (page.items.length === 0) break;
    if (page.items.length < page.pageSize) break;
    if (pageNum * page.pageSize >= total) break;
    pageNum += 1;
  }

  if (!wantAddr && symbolHits.length > 1) {
    // Prefer native (null address) when Max/agent omitted address.
    const native = symbolHits.find((a) => !a.address);
    if (native) return { match: native, scanned };
    return { scanned, ambiguous: symbolHits };
  }
  if (!wantAddr && symbolHits.length === 1) {
    return { match: symbolHits[0], scanned };
  }
  return { scanned };
}

/**
 * Resolve decimals for a short asset ref via SWP catalog.
 * Sell assets: `/assets/from`. Buy assets: `/assets/to` (needs `from` context).
 *
 * Walks catalog pages (not just page 1). Prefer passing `decimals` from
 * `list_swap_assets` to skip lookup entirely.
 */
export async function resolveSwapAsset(
  token: string,
  ref: { network: string; symbol: string; address?: string | null; decimals?: number },
  opts: SwapCallOpts & {
    /** When resolving a buy-side asset, pass the sell asset for `/assets/to`. */
    fromForToLookup?: Pick<SwapAsset, "network" | "symbol" | "address">;
  } = {},
): Promise<SwapAsset> {
  if (ref.decimals !== undefined && Number.isFinite(ref.decimals)) {
    return {
      network: ref.network.toLowerCase(),
      symbol: ref.symbol,
      address: ref.address ?? null,
      decimals: ref.decimals,
    };
  }

  const networkFilter = [ref.network];
  const fetchWithSearch = (page: number, pageSize: number) =>
    opts.fromForToLookup
      ? listSwapAssetsTo(
          token,
          {
            from: opts.fromForToLookup,
            search: ref.symbol,
            networks: networkFilter,
            page,
            pageSize,
          },
          opts,
        )
      : listSwapAssetsFrom(
          token,
          {
            search: ref.symbol,
            networks: networkFilter,
            page,
            pageSize,
          },
          opts,
        );

  // 1) Symbol search + paginate (usual path).
  let result = await findAssetAcrossPages(fetchWithSearch, ref);

  // 2) Fallback: no findBySymbol — only network filter. Needed when search
  //    ranking buries an exact symbol/address past RESOLVE_MAX_PAGES, or when
  //    findBySymbol is too narrow. Still capped.
  if (!result.match && !result.ambiguous && ref.address) {
    const fetchNoSearch = (page: number, pageSize: number) =>
      opts.fromForToLookup
        ? listSwapAssetsTo(
            token,
            {
              from: opts.fromForToLookup,
              networks: networkFilter,
              page,
              pageSize,
            },
            opts,
          )
        : listSwapAssetsFrom(
            token,
            {
              networks: networkFilter,
              page,
              pageSize,
            },
            opts,
          );
    result = await findAssetAcrossPages(fetchNoSearch, ref);
  }

  if (result.match) return result.match;

  if (result.ambiguous?.length) {
    const sample = result.ambiguous
      .slice(0, 5)
      .map((a) => a.address ?? "native")
      .join(", ");
    throw new Error(
      `Asset ${ref.symbol} on ${ref.network} is ambiguous (${result.ambiguous.length} contracts). ` +
        `Pass address (and preferably decimals) from list_swap_assets. Examples: ${sample}`,
    );
  }

  throw new Error(
    `Asset ${ref.symbol} on ${ref.network}` +
      (ref.address ? ` (${ref.address})` : " (native)") +
      " not found in SWP catalog after paging. Pass decimals from list_swap_assets, or ensure the pair is valid.",
  );
}

export function assetKey(a: Pick<SwapAsset, "network" | "symbol" | "address">): string {
  return `${a.network.toLowerCase()}|${a.symbol.toLowerCase()}|${(a.address ?? "").toLowerCase()}`;
}
