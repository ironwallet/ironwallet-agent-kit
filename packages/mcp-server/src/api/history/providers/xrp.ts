/**
 * XRP Ledger `account_tx` (rippled JSON-RPC). Newest first with `forward:false`;
 * the page cursor is the JSON `marker`. Payments in XRP report drops; issued
 * currencies (IOUs) are decimal strings on the ledger, so for them `raw` and
 * `formatted` are the same decimal value with `decimals: 0`. Memos are not
 * surfaced (free-form text from strangers).
 */

import { httpJson } from "../../http.js";
import { amountOf, asString, feeOf, sanitizeSymbol, toBigInt, tokenAsset } from "../normalize.js";
import type {
  HistoryItem,
  HistoryProvider,
  HistorySource,
  SourceContext,
  SourceItem,
  SourcePage,
} from "../types.js";

/** Seconds between the Unix epoch and the Ripple epoch (2000-01-01). */
const RIPPLE_EPOCH_OFFSET = 946684800;

type XrpAmount = string | { currency?: string; issuer?: string; value?: string };

interface XrpTxJson {
  TransactionType?: string;
  Account?: string;
  Destination?: string;
  Amount?: XrpAmount;
  DeliverMax?: XrpAmount;
  Fee?: string;
  date?: number;
  hash?: string;
  ledger_index?: number;
}

export interface XrpAccountTxEntry {
  tx?: XrpTxJson;
  tx_json?: XrpTxJson;
  hash?: string;
  ledger_index?: number;
  close_time_iso?: string;
  validated?: boolean;
  meta?: { TransactionResult?: string; delivered_amount?: XrpAmount };
}

interface AccountTxResult {
  result?: {
    status?: string;
    error?: string;
    error_message?: string;
    transactions?: XrpAccountTxEntry[];
    marker?: unknown;
  };
}

/** 160-bit hex currency codes are ASCII padded with zeros. */
function currencyCode(code: string | undefined): string {
  if (!code) return "IOU";
  if (/^[0-9A-F]{40}$/i.test(code)) {
    const ascii = Buffer.from(code, "hex").toString("latin1").replace(/\0+$/, "");
    return sanitizeSymbol(ascii, "IOU");
  }
  return sanitizeSymbol(code, "IOU");
}

export function mapXrpEntry(entry: XrpAccountTxEntry, address: string): SourceItem | null {
  const tx = entry.tx ?? entry.tx_json;
  if (!tx) return null;
  const hash = asString(tx.hash) ?? asString(entry.hash);
  if (!hash) return null;

  let ts: number | null = null;
  let iso: string | null = null;
  if (typeof tx.date === "number") {
    ts = (tx.date + RIPPLE_EPOCH_OFFSET) * 1000;
    iso = new Date(ts).toISOString();
  } else if (entry.close_time_iso) {
    const parsed = Date.parse(entry.close_time_iso);
    if (!Number.isNaN(parsed)) {
      ts = parsed;
      iso = new Date(parsed).toISOString();
    }
  }

  const result = entry.meta?.TransactionResult;
  const status = entry.validated === false ? "pending" : result && result !== "tesSUCCESS" ? "failed" : "confirmed";
  const from = asString(tx.Account);
  const to = asString(tx.Destination);
  const fromSelf = from === address;
  const toSelf = to === address;
  const direction = fromSelf && toSelf ? "self" : fromSelf ? "out" : "in";
  const fee = fromSelf ? feeOf(toBigInt(tx.Fee ?? 0), 6, "XRP") : null;
  const ledger = tx.ledger_index ?? entry.ledger_index ?? null;

  let item: HistoryItem;
  if (tx.TransactionType === "Payment") {
    const delivered = entry.meta?.delivered_amount ?? tx.Amount ?? tx.DeliverMax;
    if (typeof delivered === "string" || delivered === undefined) {
      item = {
        hash,
        timestamp: iso,
        block: ledger,
        kind: "transfer",
        direction,
        status,
        from,
        to,
        asset: { symbol: "XRP", contractAddress: null, decimals: 6 },
        amount: amountOf(toBigInt(delivered ?? "0"), 6),
        fee,
      };
    } else {
      const value = typeof delivered.value === "string" && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(delivered.value)
        ? delivered.value.replace(/^-/, "")
        : "0";
      item = {
        hash,
        timestamp: iso,
        block: ledger,
        kind: "token_transfer",
        direction,
        status,
        from,
        to,
        asset: tokenAsset(currencyCode(delivered.currency), "IOU", asString(delivered.issuer), 0),
        amount: { raw: value, formatted: value },
        fee,
      };
    }
  } else {
    item = {
      hash,
      timestamp: iso,
      block: ledger,
      kind: "other",
      direction: fromSelf ? "out" : "in",
      status,
      from,
      to: to ?? (fromSelf ? null : address),
      asset: { symbol: "XRP", contractAddress: null, decimals: 6 },
      amount: amountOf(0n, 6),
      fee,
    };
  }
  return { ts: ts ?? 0, item };
}

export function xrpProvider(rpcUrl: string, address: string): HistoryProvider {
  const source: HistorySource = {
    name: "xrp",
    async fetchPage(cursor: string | null, pageSize: number, ctx: SourceContext): Promise<SourcePage> {
      let marker: unknown;
      if (cursor !== null) {
        try {
          marker = JSON.parse(cursor);
        } catch {
          throw new Error("Invalid cursor for xrp source.");
        }
      }
      const res = await httpJson<AccountTxResult>(
        rpcUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            method: "account_tx",
            params: [
              {
                account: address,
                limit: pageSize,
                ledger_index_min: -1,
                ledger_index_max: -1,
                forward: false,
                ...(marker !== undefined ? { marker } : {}),
              },
            ],
          }),
        },
        { ...ctx.http, label: "history.xrp.account_tx", retry: true },
      );
      const result = res.result ?? {};
      if (result.error === "actNotFound") return { items: [], next: null };
      if (result.status !== "success" || !Array.isArray(result.transactions)) {
        throw new Error(`xrp account_tx: ${result.error_message ?? result.error ?? "unexpected response"}`);
      }
      const items = result.transactions
        .map((entry) => mapXrpEntry(entry, address))
        .filter((x): x is SourceItem => x !== null);
      const next = result.marker !== undefined && result.marker !== null ? JSON.stringify(result.marker) : null;
      return { items, next };
    },
  };
  return { label: "xrpl", sources: [source] };
}
