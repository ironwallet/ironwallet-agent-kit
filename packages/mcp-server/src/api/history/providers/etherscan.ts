/**
 * Etherscan-compatible `module=account` API (Blockscout, Routescan/Snowtrace).
 * Two newest-first sources: `txlist` (native transfers + contract calls made or
 * received by the address) and `tokentx` (ERC-20 transfers). Page-based
 * (`page` / `offset`), so a page cursor is just the page number.
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
  timeFrom,
  tokenAsset,
  toBigInt,
  toBlockNumber,
} from "../normalize.js";
import {
  HISTORY_MAX_LIMIT,
  type HistoryItem,
  type HistoryProvider,
  type HistorySource,
  type SourceContext,
  type SourceItem,
  type SourcePage,
} from "../types.js";

interface EtherscanEnvelope {
  status?: string;
  message?: string;
  result?: unknown;
}

export interface EtherscanTx {
  blockNumber?: string;
  timeStamp?: string;
  hash?: string;
  from?: string;
  to?: string;
  value?: string;
  gasPrice?: string;
  gasUsed?: string;
  isError?: string;
  txreceipt_status?: string;
  input?: string;
  contractAddress?: string;
  /** tokentx only */
  tokenSymbol?: string;
  tokenDecimal?: string;
}

/** Empty result sets come back as status "0" with a "No … found" message; treat as []. */
export function unwrapEtherscanResult(res: EtherscanEnvelope, label: string): EtherscanTx[] {
  if (Array.isArray(res.result)) return res.result as EtherscanTx[];
  const message = `${res.message ?? ""} ${typeof res.result === "string" ? res.result : ""}`;
  if (/no (transactions|token transfers|records) found/i.test(message)) return [];
  throw new Error(`${label}: ${message.trim() || "unexpected response"}`);
}

export function mapNativeTx(tx: EtherscanTx, address: string, network: NetworkId): SourceItem | null {
  const hash = asString(tx.hash);
  if (!hash) return null;
  const time = timeFrom(tx.timeStamp);
  const isSelf = evmAddressMatcher(address);
  const from = asString(tx.from);
  const to = asString(tx.to) ?? asString(tx.contractAddress);
  const value = toBigInt(tx.value);
  const input = tx.input ?? "0x";
  const failed = tx.isError === "1" || tx.txreceipt_status === "0";
  const direction = directionOf(from, to, isSelf);
  const feeRaw = toBigInt(tx.gasUsed) * toBigInt(tx.gasPrice);
  const symbol = NATIVE_SYMBOL[network];
  const item: HistoryItem = {
    hash,
    timestamp: time?.iso ?? null,
    block: toBlockNumber(tx.blockNumber),
    kind: value > 0n ? "transfer" : input.length > 2 ? "contract_call" : "other",
    direction,
    status: failed ? "failed" : "confirmed",
    from,
    to,
    asset: { symbol, contractAddress: null, decimals: 18 },
    amount: amountOf(value, 18),
    fee: direction === "in" ? null : feeOf(feeRaw, 18, symbol),
  };
  return { ts: time?.ts ?? 0, item };
}

export function mapTokenTx(tx: EtherscanTx, address: string, network: NetworkId): SourceItem | null {
  const hash = asString(tx.hash);
  const contract = asString(tx.contractAddress);
  if (!hash || !contract) return null;
  const time = timeFrom(tx.timeStamp);
  const isSelf = evmAddressMatcher(address);
  const from = asString(tx.from);
  const to = asString(tx.to);
  const decimals = clampDecimals(tx.tokenDecimal, 18);
  const direction = directionOf(from, to, isSelf);
  const feeRaw = toBigInt(tx.gasUsed) * toBigInt(tx.gasPrice);
  const item: HistoryItem = {
    hash,
    timestamp: time?.iso ?? null,
    block: toBlockNumber(tx.blockNumber),
    kind: "token_transfer",
    direction,
    status: "confirmed",
    from,
    to,
    asset: tokenAsset(tx.tokenSymbol, "TOKEN", contract, decimals),
    amount: amountOf(toBigInt(tx.value), decimals),
    fee: direction === "in" ? null : feeOf(feeRaw, 18, NATIVE_SYMBOL[network]),
  };
  return { ts: time?.ts ?? 0, item };
}

function pageNumber(cursor: string | null): number {
  if (cursor === null) return 1;
  const n = Number.parseInt(cursor, 10);
  if (!Number.isInteger(n) || n < 1) throw new Error("Invalid cursor for etherscan source.");
  return n;
}

/**
 * `page` only means something for a fixed `offset` (page size), and the
 * cursor must survive a different `limit` on the next call — so the size
 * requested by the merge is ignored and every page is PAGE_SIZE rows.
 */
const PAGE_SIZE = HISTORY_MAX_LIMIT;

function makeSource(
  name: string,
  action: "txlist" | "tokentx",
  baseUrl: string,
  address: string,
  network: NetworkId,
  map: (tx: EtherscanTx, address: string, network: NetworkId) => SourceItem | null,
): HistorySource {
  return {
    name,
    async fetchPage(cursor: string | null, _pageSize: number, ctx: SourceContext): Promise<SourcePage> {
      const page = pageNumber(cursor);
      const url =
        `${baseUrl}?module=account&action=${action}&address=${encodeURIComponent(address)}` +
        `&page=${page}&offset=${PAGE_SIZE}&sort=desc`;
      const res = await httpJson<EtherscanEnvelope>(
        url,
        { method: "GET" },
        { ...ctx.http, label: `history.etherscan.${action}` },
      );
      const rows = unwrapEtherscanResult(res, `etherscan ${action}`);
      const items = rows.map((tx) => map(tx, address, network)).filter((x): x is SourceItem => x !== null);
      return { items, next: rows.length < PAGE_SIZE ? null : String(page + 1) };
    },
  };
}

export function etherscanProvider(baseUrl: string, address: string, network: NetworkId): HistoryProvider {
  const label = /blockscout\.com/i.test(baseUrl)
    ? "blockscout"
    : /routescan\.io|snowtrace/i.test(baseUrl)
      ? "routescan"
      : "etherscan-compatible";
  return {
    label,
    sources: [
      makeSource("native", "txlist", baseUrl, address, network, mapNativeTx),
      makeSource("erc20", "tokentx", baseUrl, address, network, mapTokenTx),
    ],
  };
}
