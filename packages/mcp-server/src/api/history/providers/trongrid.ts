/**
 * TronGrid `/v1/accounts/{address}/transactions` (+ `/trc20`). Independent
 * fallback for Tron. Cursor-based via `meta.fingerprint`; addresses in the
 * raw transaction are hex (41…) and are re-encoded to base58 here.
 */

import bs58check from "bs58check";
import { httpJson } from "../../http.js";
import { paced } from "../pace.js";
import {
  amountOf,
  asString,
  clampDecimals,
  directionOf,
  exactAddressMatcher,
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

export interface TronGridTx {
  txID?: string;
  blockNumber?: number;
  block_timestamp?: number;
  ret?: Array<{ contractRet?: string; fee?: number }>;
  raw_data?: {
    contract?: Array<{
      type?: string;
      parameter?: {
        value?: {
          amount?: number | string;
          owner_address?: string;
          to_address?: string;
          contract_address?: string;
          asset_name?: string;
          call_value?: number;
        };
      };
    }>;
  };
}

export interface TronGridTrc20 {
  transaction_id?: string;
  block_timestamp?: number;
  from?: string;
  to?: string;
  type?: string;
  value?: string;
  token_info?: { symbol?: string; address?: string; decimals?: number };
}

interface TronGridEnvelope<T> {
  success?: boolean;
  data?: T[];
  meta?: { fingerprint?: string };
  error?: string;
}

/** 41-prefixed hex → base58check "T…" address. Returns the input when it is not hex. */
export function tronHexToBase58(value: string | undefined | null): string | null {
  if (!value) return null;
  if (!/^(0x)?41[0-9a-fA-F]{40}$/.test(value)) return value;
  try {
    return bs58check.encode(Buffer.from(value.replace(/^0x/, ""), "hex"));
  } catch {
    return value;
  }
}

export function mapTronGridTx(tx: TronGridTx, address: string): SourceItem | null {
  const hash = asString(tx.txID);
  if (!hash) return null;
  const time = timeFrom(tx.block_timestamp);
  const isSelf = exactAddressMatcher(address);
  const contract = tx.raw_data?.contract?.[0];
  const value = contract?.parameter?.value ?? {};
  const type = contract?.type ?? "";
  const from = tronHexToBase58(value.owner_address);
  const to = tronHexToBase58(value.to_address) ?? tronHexToBase58(value.contract_address);
  const direction = directionOf(from, to, isSelf);
  const ret = tx.ret?.[0];
  const status = ret?.contractRet && ret.contractRet !== "SUCCESS" ? "failed" : "confirmed";
  const fee = direction === "in" ? null : feeOf(toBigInt(ret?.fee ?? 0), 6, "TRX");
  const base = {
    hash,
    timestamp: time?.iso ?? null,
    block: toBlockNumber(tx.blockNumber),
    direction,
    status,
    from,
    to,
    fee,
  } as const;

  let item: HistoryItem;
  if (type === "TransferContract") {
    item = {
      ...base,
      kind: "transfer",
      asset: { symbol: "TRX", contractAddress: null, decimals: 6 },
      amount: amountOf(toBigInt(value.amount), 6),
    };
  } else if (type === "TransferAssetContract") {
    // TRC-10: TronGrid gives the asset id as hex ASCII; decimals are not in the
    // payload, so amounts are reported in base units (decimals 0).
    const assetId = value.asset_name ? Buffer.from(value.asset_name, "hex").toString("utf8") : null;
    item = {
      ...base,
      kind: "token_transfer",
      asset: tokenAsset(assetId, "TRC10", assetId, 0),
      amount: amountOf(toBigInt(value.amount), 0),
    };
  } else {
    item = {
      ...base,
      kind: type === "TriggerSmartContract" ? "contract_call" : "other",
      asset: { symbol: "TRX", contractAddress: null, decimals: 6 },
      amount: amountOf(toBigInt(value.call_value ?? 0), 6),
    };
  }
  return { ts: time?.ts ?? 0, item };
}

export function mapTronGridTrc20(row: TronGridTrc20, address: string): SourceItem | null {
  const hash = asString(row.transaction_id);
  const contract = asString(row.token_info?.address);
  if (!hash || !contract) return null;
  if (row.type && row.type !== "Transfer") return null; // Approval events etc.
  const time = timeFrom(row.block_timestamp);
  const decimals = clampDecimals(row.token_info?.decimals, 6);
  const from = asString(row.from);
  const to = asString(row.to);
  const item: HistoryItem = {
    hash,
    timestamp: time?.iso ?? null,
    block: null,
    kind: "token_transfer",
    direction: directionOf(from, to, exactAddressMatcher(address)),
    status: "confirmed",
    from,
    to,
    asset: tokenAsset(row.token_info?.symbol, "TRC20", contract, decimals),
    amount: amountOf(toBigInt(row.value), decimals),
    fee: null,
  };
  return { ts: time?.ts ?? 0, item };
}

/**
 * Keyless TronGrid advertises 3 requests per second per IP, but after a few
 * violations it drops the IP to 1 rps and suspends it for ~5 s on each
 * further burst. Two sources × two pages in parallel trip that on every call,
 * so requests are spaced ≥1.1 s apart process-wide. Slower, but this is the
 * fallback: it has to answer, not to be fast.
 */
const KEYLESS_GAP_MS = 1100;

/**
 * A TronGrid fingerprint is bound to the exact query, `limit` included, so
 * the page size must not follow the caller's `limit`: fixed at the tool cap.
 */
const PAGE_SIZE = HISTORY_MAX_LIMIT;

function makeSource<T>(
  name: string,
  path: string,
  baseUrl: string,
  address: string,
  map: (row: T, address: string) => SourceItem | null,
): HistorySource {
  return {
    name,
    async fetchPage(cursor: string | null, _pageSize: number, ctx: SourceContext): Promise<SourcePage> {
      const url =
        `${baseUrl}/v1/accounts/${encodeURIComponent(address)}/transactions${path}` +
        `?limit=${PAGE_SIZE}&order_by=block_timestamp,desc&only_confirmed=true` +
        (cursor ? `&fingerprint=${encodeURIComponent(cursor)}` : "");
      const res = await paced("trongrid", KEYLESS_GAP_MS, () =>
        httpJson<TronGridEnvelope<T>>(
          url,
          { method: "GET" },
          { ...ctx.http, label: `history.trongrid${path || ".tx"}` },
        ),
      );
      if (res.success === false || !Array.isArray(res.data)) {
        throw new Error(`trongrid${path}: ${res.error ?? "unexpected response"}`);
      }
      const items = res.data.map((row) => map(row, address)).filter((x): x is SourceItem => x !== null);
      const next = res.data.length < PAGE_SIZE ? null : (res.meta?.fingerprint ?? null);
      return { items, next };
    },
  };
}

export function trongridProvider(baseUrl: string, address: string): HistoryProvider {
  return {
    label: "trongrid",
    sources: [
      makeSource<TronGridTx>("native", "", baseUrl, address, mapTronGridTx),
      makeSource<TronGridTrc20>("trc20", "/trc20", baseUrl, address, mapTronGridTrc20),
    ],
  };
}
