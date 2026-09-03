/**
 * NodeReal BSC explorer backend (the API behind bsctrace.com). Undocumented and
 * keyless; the only keyless address-scoped BSC history we found. Two sources:
 * `external` (top-level transactions) and `20` (BEP-20 transfers). Page-based.
 * Any non-2xx (including its odd HTTP 566) fails the source so the tool can
 * report "unavailable" instead of an empty history.
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

export interface NodeRealTransfer {
  category?: string;
  blockNum?: string;
  from?: string;
  to?: string;
  value?: string;
  asset?: string;
  hash?: string;
  contractAddress?: string;
  decimal?: string;
  blockTimeStamp?: number;
  gasPrice?: number;
  gasUsed?: number;
  receiptsStatus?: number;
  input?: string;
}

interface NodeRealEnvelope {
  code?: number;
  msg?: string;
  data?: { total?: number; list?: NodeRealTransfer[] };
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function mapNodeRealTransfer(
  row: NodeRealTransfer,
  address: string,
  network: NetworkId,
): SourceItem | null {
  const hash = asString(row.hash);
  if (!hash) return null;
  const time = timeFrom(row.blockTimeStamp);
  const isSelf = evmAddressMatcher(address);
  const from = asString(row.from);
  const to = asString(row.to);
  const direction = directionOf(from, to, isSelf);
  const value = toBigInt(row.value);
  const failed = row.receiptsStatus === 0;
  const feeRaw = toBigInt(row.gasUsed) * toBigInt(row.gasPrice);
  const nativeSymbol = NATIVE_SYMBOL[network];
  const isToken = row.category === "20";
  const contract = asString(row.contractAddress);

  const item: HistoryItem = {
    hash,
    timestamp: time?.iso ?? null,
    block: toBlockNumber(row.blockNum),
    kind: isToken
      ? "token_transfer"
      : value > 0n
        ? "transfer"
        : (row.input ?? "0x").length > 2
          ? "contract_call"
          : "other",
    direction,
    status: failed ? "failed" : "confirmed",
    from,
    to,
    asset: isToken
      ? tokenAsset(
          row.asset,
          "TOKEN",
          contract && contract !== ZERO_ADDRESS ? contract : null,
          clampDecimals(row.decimal, 18),
        )
      : { symbol: nativeSymbol, contractAddress: null, decimals: 18 },
    amount: amountOf(value, isToken ? clampDecimals(row.decimal, 18) : 18),
    fee: direction === "in" ? null : feeOf(feeRaw, 18, nativeSymbol),
  };
  return { ts: time?.ts ?? 0, item };
}

function pageNumber(cursor: string | null): number {
  if (cursor === null) return 1;
  const n = Number.parseInt(cursor, 10);
  if (!Number.isInteger(n) || n < 1) throw new Error("Invalid cursor for nodereal source.");
  return n;
}

/**
 * Page numbers only mean something for a fixed page size, and the cursor
 * must survive a different `limit` on the next call — so the size requested
 * by the merge is ignored and every page is PAGE_SIZE rows.
 */
const PAGE_SIZE = HISTORY_MAX_LIMIT;

function makeSource(name: string, type: string, baseUrl: string, address: string, network: NetworkId): HistorySource {
  return {
    name,
    async fetchPage(cursor: string | null, _pageSize: number, ctx: SourceContext): Promise<SourcePage> {
      const page = pageNumber(cursor);
      const url =
        `${baseUrl}/tx/getAssetTransferByAddress?address=${encodeURIComponent(address)}` +
        `&type=${type}&pageSize=${PAGE_SIZE}&page=${page}&order=desc`;
      const res = await httpJson<NodeRealEnvelope>(
        url,
        { method: "GET" },
        { ...ctx.http, label: `history.nodereal.${type}` },
      );
      if (res.code !== 0 || !res.data) {
        throw new Error(`nodereal ${type}: ${res.msg ?? "unexpected response"}`);
      }
      const rows = res.data.list ?? [];
      const items = rows
        .map((row) => mapNodeRealTransfer(row, address, network))
        .filter((x): x is SourceItem => x !== null);
      return { items, next: rows.length < PAGE_SIZE ? null : String(page + 1) };
    },
  };
}

export function noderealProvider(baseUrl: string, address: string, network: NetworkId): HistoryProvider {
  return {
    label: "nodereal",
    sources: [
      makeSource("native", "external", baseUrl, address, network),
      makeSource("bep20", "20", baseUrl, address, network),
    ],
  };
}
