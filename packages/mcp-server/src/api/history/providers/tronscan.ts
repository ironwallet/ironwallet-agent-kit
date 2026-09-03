/**
 * TronScan API (apilist.tronscanapi.com shape), reached through the team's
 * keyless caching proxy at tronscanner.org/api/tron. Two sources:
 * `/transaction` (all transactions of the address, newest first) and
 * `/token_trc20/transfers`. Offset-based (`start` / `limit`), TronScan caps
 * `limit` at 50 — same as the tool's max.
 */

import { httpJson } from "../../http.js";
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
import type {
  HistoryItem,
  HistoryProvider,
  HistorySource,
  SourceContext,
  SourceItem,
  SourcePage,
} from "../types.js";

/** TRON contract types that move TRX or TRC-10 (protocol.Transaction.Contract.ContractType). */
const TRANSFER_CONTRACT = 1;
const TRANSFER_ASSET_CONTRACT = 2;
const TRIGGER_SMART_CONTRACT = 31;

export interface TronScanTx {
  hash?: string;
  block?: number;
  timestamp?: number;
  ownerAddress?: string;
  toAddress?: string;
  contractType?: number;
  confirmed?: boolean;
  revert?: boolean;
  contractRet?: string;
  amount?: string | number;
  cost?: { fee?: number; net_fee?: number; energy_fee?: number };
  tokenInfo?: { tokenId?: string; tokenAbbr?: string; tokenDecimal?: number; tokenType?: string };
  trigger_info?: { contract_address?: string };
}

export interface TronScanTrc20Transfer {
  transaction_id?: string;
  block?: number;
  block_ts?: number;
  from_address?: string;
  to_address?: string;
  contract_address?: string;
  quant?: string;
  confirmed?: boolean;
  contractRet?: string;
  finalResult?: string;
  revert?: boolean;
  tokenInfo?: { tokenId?: string; tokenAbbr?: string; tokenDecimal?: number };
}

/**
 * TronScan's `confirmed:false` means "not yet solid" (~1 minute), the tx is
 * already in a block. Only rows without a block are reported as pending.
 */
function tronStatus(block: number | undefined, ret: string | undefined, revert: boolean | undefined) {
  if (revert || (ret && ret !== "SUCCESS")) return "failed" as const;
  return typeof block === "number" && block > 0 ? ("confirmed" as const) : ("pending" as const);
}

export function mapTronScanTx(tx: TronScanTx, address: string): SourceItem | null {
  const hash = asString(tx.hash);
  if (!hash) return null;
  const time = timeFrom(tx.timestamp);
  const isSelf = exactAddressMatcher(address);
  const from = asString(tx.ownerAddress);
  const to = asString(tx.toAddress) ?? asString(tx.trigger_info?.contract_address);
  const direction = directionOf(from, to, isSelf);
  const status = tronStatus(tx.block, tx.contractRet, tx.revert);
  const feeRaw = toBigInt(tx.cost?.fee ?? 0);
  const amount = toBigInt(tx.amount);
  const contractType = tx.contractType;

  let item: HistoryItem;
  if (contractType === TRANSFER_CONTRACT) {
    item = {
      hash,
      timestamp: time?.iso ?? null,
      block: toBlockNumber(tx.block),
      kind: "transfer",
      direction,
      status,
      from,
      to,
      asset: { symbol: "TRX", contractAddress: null, decimals: 6 },
      amount: amountOf(amount, 6),
      fee: direction === "in" ? null : feeOf(feeRaw, 6, "TRX"),
    };
  } else if (contractType === TRANSFER_ASSET_CONTRACT) {
    const decimals = clampDecimals(tx.tokenInfo?.tokenDecimal, 6);
    item = {
      hash,
      timestamp: time?.iso ?? null,
      block: toBlockNumber(tx.block),
      kind: "token_transfer",
      direction,
      status,
      from,
      to,
      asset: tokenAsset(tx.tokenInfo?.tokenAbbr, "TRC10", asString(tx.tokenInfo?.tokenId), decimals),
      amount: amountOf(amount, decimals),
      fee: direction === "in" ? null : feeOf(feeRaw, 6, "TRX"),
    };
  } else {
    // TriggerSmartContract and everything else. TRC-20 amounts come from the
    // dedicated transfers source; here we only record the call (and TRX sent
    // along with it via call_value, which TronScan reports as `amount`).
    item = {
      hash,
      timestamp: time?.iso ?? null,
      block: toBlockNumber(tx.block),
      kind: contractType === TRIGGER_SMART_CONTRACT ? "contract_call" : "other",
      direction,
      status,
      from,
      to,
      asset: { symbol: "TRX", contractAddress: null, decimals: 6 },
      amount: amountOf(amount, 6),
      fee: direction === "in" ? null : feeOf(feeRaw, 6, "TRX"),
    };
  }
  return { ts: time?.ts ?? 0, item };
}

export function mapTronScanTrc20(row: TronScanTrc20Transfer, address: string): SourceItem | null {
  const hash = asString(row.transaction_id);
  const contract = asString(row.contract_address) ?? asString(row.tokenInfo?.tokenId);
  if (!hash || !contract) return null;
  const time = timeFrom(row.block_ts);
  const isSelf = exactAddressMatcher(address);
  const from = asString(row.from_address);
  const to = asString(row.to_address);
  const decimals = clampDecimals(row.tokenInfo?.tokenDecimal, 6);
  const item: HistoryItem = {
    hash,
    timestamp: time?.iso ?? null,
    block: toBlockNumber(row.block),
    kind: "token_transfer",
    direction: directionOf(from, to, isSelf),
    status: tronStatus(row.block, row.finalResult ?? row.contractRet, row.revert),
    from,
    to,
    asset: tokenAsset(row.tokenInfo?.tokenAbbr, "TRC20", contract, decimals),
    amount: amountOf(toBigInt(row.quant), decimals),
    // The TRX fee sits on the transaction row (same hash) in the "native" source.
    fee: null,
  };
  return { ts: time?.ts ?? 0, item };
}

function offsetOf(cursor: string | null): number {
  if (cursor === null) return 0;
  const n = Number.parseInt(cursor, 10);
  if (!Number.isInteger(n) || n < 0) throw new Error("Invalid cursor for tronscan source.");
  return n;
}

export function tronscanProvider(baseUrl: string, address: string): HistoryProvider {
  const native: HistorySource = {
    name: "native",
    async fetchPage(cursor: string | null, pageSize: number, ctx: SourceContext): Promise<SourcePage> {
      const start = offsetOf(cursor);
      const url =
        `${baseUrl}/transaction?address=${encodeURIComponent(address)}` +
        `&limit=${pageSize}&start=${start}&sort=-timestamp&count=true`;
      const res = await httpJson<{ data?: TronScanTx[]; total?: number }>(
        url,
        { method: "GET" },
        { ...ctx.http, label: "history.tronscan.transaction" },
      );
      const rows = Array.isArray(res.data) ? res.data : null;
      if (!rows) throw new Error("tronscan transaction: unexpected response");
      const items = rows.map((tx) => mapTronScanTx(tx, address)).filter((x): x is SourceItem => x !== null);
      return { items, next: rows.length < pageSize ? null : String(start + rows.length) };
    },
  };
  const trc20: HistorySource = {
    name: "trc20",
    async fetchPage(cursor: string | null, pageSize: number, ctx: SourceContext): Promise<SourcePage> {
      const start = offsetOf(cursor);
      const url =
        `${baseUrl}/token_trc20/transfers?relatedAddress=${encodeURIComponent(address)}` +
        `&limit=${pageSize}&start=${start}`;
      const res = await httpJson<{ token_transfers?: TronScanTrc20Transfer[] }>(
        url,
        { method: "GET" },
        { ...ctx.http, label: "history.tronscan.trc20" },
      );
      const rows = Array.isArray(res.token_transfers) ? res.token_transfers : null;
      if (!rows) throw new Error("tronscan token_trc20/transfers: unexpected response");
      const items = rows.map((row) => mapTronScanTrc20(row, address)).filter((x): x is SourceItem => x !== null);
      return { items, next: rows.length < pageSize ? null : String(start + rows.length) };
    },
  };
  return { label: "tronscan", sources: [native, trc20] };
}
