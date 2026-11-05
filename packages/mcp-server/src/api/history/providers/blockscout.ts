/**
 * Blockscout REST API v2 (`/api/v2/addresses/{address}/…`).
 *
 * Blockscout throttles its Etherscan-compatible `/api` to 10 requests per
 * 15 minutes per IP without an API key — two history pages exhaust it — while
 * the v2 REST API allows 180 requests per 30 seconds. Profiles use
 * `kind: "blockscout"` with the `…/api/v2` base; index.ts also routes older
 * `kind: "etherscan"` entries with a Blockscout `…/api` URL here.
 *
 * Two newest-first sources, like the Etherscan provider: `transactions`
 * (native transfers + contract calls) and `token-transfers?type=ERC-20`.
 * Pages are keyset-based: the cursor is the JSON of `next_page_params`.
 */

import type { NetworkId } from "../../../networks.js";
import { NATIVE_SYMBOL } from "../../balances.js";
import { httpJson } from "../../http.js";
import {
  amountOf,
  asString,
  clampDecimals,
  directionOf,
  evmAddressMatcher,
  feeOf,
  pendingTs,
  timeFrom,
  tokenAsset,
  toBigInt,
  toBlockNumber,
} from "../normalize.js";
import type { HistoryItem, HistoryProvider, HistorySource, SourceContext, SourceItem, SourcePage } from "../types.js";

interface BlockscoutAddressRef {
  hash?: string;
}

export interface BlockscoutTx {
  hash?: string;
  timestamp?: string | null;
  block_number?: number | null;
  from?: BlockscoutAddressRef | null;
  to?: BlockscoutAddressRef | null;
  created_contract?: BlockscoutAddressRef | null;
  value?: string;
  fee?: { value?: string } | null;
  /** "ok" | "error"; null while pending. */
  status?: string | null;
  /** "success" | "pending" | revert reason. */
  result?: string | null;
  raw_input?: string;
}

export interface BlockscoutTokenTransfer {
  transaction_hash?: string;
  timestamp?: string | null;
  block_number?: number | null;
  from?: BlockscoutAddressRef | null;
  to?: BlockscoutAddressRef | null;
  token?: { address_hash?: string; address?: string; symbol?: string | null; decimals?: string | null } | null;
  total?: { value?: string; decimals?: string | null } | null;
}

interface BlockscoutPage<T> {
  items?: T[];
  next_page_params?: Record<string, unknown> | null;
}

function isPending(tx: BlockscoutTx): boolean {
  return tx.result === "pending" || (tx.status == null && tx.block_number == null);
}

export function mapBlockscoutTx(tx: BlockscoutTx, address: string, network: NetworkId): SourceItem | null {
  const hash = asString(tx.hash);
  if (!hash) return null;
  const pending = isPending(tx);
  const time = timeFrom(tx.timestamp);
  const isSelf = evmAddressMatcher(address);
  const from = asString(tx.from?.hash);
  const to = asString(tx.to?.hash) ?? asString(tx.created_contract?.hash);
  const value = toBigInt(tx.value);
  const input = tx.raw_input ?? "0x";
  const direction = directionOf(from, to, isSelf);
  const symbol = NATIVE_SYMBOL[network];
  const item: HistoryItem = {
    hash,
    timestamp: time?.iso ?? null,
    block: toBlockNumber(tx.block_number),
    kind: value > 0n ? "transfer" : input.length > 2 ? "contract_call" : "other",
    direction,
    status: pending ? "pending" : tx.status === "error" ? "failed" : "confirmed",
    from,
    to,
    asset: { symbol, contractAddress: null, decimals: 18 },
    amount: amountOf(value, 18),
    fee: direction === "in" ? null : feeOf(toBigInt(tx.fee?.value), 18, symbol),
  };
  return { ts: time?.ts ?? (pending ? pendingTs() : 0), item };
}

export function mapBlockscoutTokenTransfer(
  tr: BlockscoutTokenTransfer,
  address: string,
): SourceItem | null {
  const hash = asString(tr.transaction_hash);
  const contract = asString(tr.token?.address_hash) ?? asString(tr.token?.address);
  if (!hash || !contract) return null;
  const time = timeFrom(tr.timestamp);
  const isSelf = evmAddressMatcher(address);
  const from = asString(tr.from?.hash);
  const to = asString(tr.to?.hash);
  const decimals = clampDecimals(tr.total?.decimals ?? tr.token?.decimals, 18);
  const item: HistoryItem = {
    hash,
    timestamp: time?.iso ?? null,
    block: toBlockNumber(tr.block_number),
    kind: "token_transfer",
    direction: directionOf(from, to, isSelf),
    status: "confirmed",
    from,
    to,
    asset: tokenAsset(tr.token?.symbol, "TOKEN", contract, decimals),
    amount: amountOf(toBigInt(tr.total?.value), decimals),
    fee: null,
  };
  return { ts: time?.ts ?? 0, item };
}

function pageQuery(cursor: string | null): string {
  if (cursor === null) return "";
  let params: unknown;
  try {
    params = JSON.parse(cursor);
  } catch {
    throw new Error("Invalid cursor for blockscout source.");
  }
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new Error("Invalid cursor for blockscout source.");
  }
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new Error("Invalid cursor for blockscout source.");
    }
    qs.set(key, String(value));
  }
  return qs.toString();
}

function makeSource<T>(
  name: string,
  url: string,
  map: (row: T) => SourceItem | null,
): HistorySource {
  return {
    name,
    async fetchPage(cursor: string | null, _pageSize: number, ctx: SourceContext): Promise<SourcePage> {
      const query = pageQuery(cursor);
      const full = query ? `${url}${url.includes("?") ? "&" : "?"}${query}` : url;
      const res = await httpJson<BlockscoutPage<T>>(
        full,
        { method: "GET", headers: { accept: "application/json" } },
        { ...ctx.http, label: `history.blockscout.${name}` },
      );
      if (!res || !Array.isArray(res.items)) throw new Error(`blockscout ${name}: unexpected response`);
      const items = res.items.map(map).filter((x): x is SourceItem => x !== null);
      const next = res.next_page_params;
      return { items, next: next && typeof next === "object" ? JSON.stringify(next) : null };
    },
  };
}

/** `https://eth.blockscout.com/api` (Etherscan-compatible base) → `https://eth.blockscout.com/api/v2`. */
export function blockscoutV2Base(url: string): string | null {
  const m = /^(https:\/\/[^/]*blockscout\.com)\/api(?:\/v2)?\/?$/i.exec(url);
  return m ? `${m[1]}/api/v2` : null;
}

export function blockscoutProvider(v2Base: string, address: string, network: NetworkId): HistoryProvider {
  const addr = `${v2Base}/addresses/${encodeURIComponent(address)}`;
  return {
    label: "blockscout",
    sources: [
      makeSource<BlockscoutTx>("native", `${addr}/transactions`, (tx) => mapBlockscoutTx(tx, address, network)),
      makeSource<BlockscoutTokenTransfer>("erc20", `${addr}/token-transfers?type=ERC-20`, (tr) =>
        mapBlockscoutTokenTransfer(tr, address),
      ),
    ],
  };
}
