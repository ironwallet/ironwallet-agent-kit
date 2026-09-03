/**
 * BlockCypher `/addrs/{a}/full` for Dogecoin. Newest first, `limit` ≤ 50,
 * paged with `before=<block height>` (exclusive). Keyless quota is small
 * (~100 req/h), which is fine for a wallet's occasional history check.
 */

import type { NetworkId } from "../../../networks.js";
import { NATIVE_SYMBOL } from "../../balances.js";
import { httpJson } from "../../http.js";
import { asString, feeOf, pendingTs, timeFrom, toBigInt } from "../normalize.js";
import { utxoSummary, type UtxoIo } from "./esplora.js";
import type {
  HistoryItem,
  HistoryProvider,
  HistorySource,
  SourceContext,
  SourceItem,
  SourcePage,
} from "../types.js";

export interface BlockCypherTx {
  hash?: string;
  block_height?: number;
  confirmed?: string;
  received?: string;
  fees?: number;
  inputs?: Array<{ addresses?: string[]; output_value?: number }>;
  outputs?: Array<{ addresses?: string[]; value?: number }>;
}

interface BlockCypherAddressFull {
  txs?: BlockCypherTx[];
  hasMore?: boolean;
  error?: string;
}

export function mapBlockCypherTx(tx: BlockCypherTx, address: string, network: NetworkId): SourceItem | null {
  const hash = asString(tx.hash);
  if (!hash) return null;
  const confirmed = typeof tx.block_height === "number" && tx.block_height > 0;
  const time = confirmed ? timeFrom(tx.confirmed) : null;
  const inputs: UtxoIo[] = (tx.inputs ?? []).map((i) => ({
    address: i.addresses?.[0] ?? null,
    value: toBigInt(i.output_value ?? 0),
  }));
  const outputs: UtxoIo[] = (tx.outputs ?? []).map((o) => ({
    address: o.addresses?.[0] ?? null,
    value: toBigInt(o.value ?? 0),
  }));
  const feeRaw = toBigInt(tx.fees ?? 0);
  const summary = utxoSummary(inputs, outputs, address);
  const symbol = NATIVE_SYMBOL[network];
  const item: HistoryItem = {
    hash,
    timestamp: time?.iso ?? null,
    block: confirmed ? (tx.block_height as number) : null,
    kind: "transfer",
    direction: summary.direction,
    status: confirmed ? "confirmed" : "pending",
    from: summary.from,
    to: summary.to,
    asset: { symbol, contractAddress: null, decimals: 8 },
    amount: summary.amount,
    fee: summary.direction === "in" ? null : feeOf(feeRaw, 8, symbol),
  };
  return { ts: time?.ts ?? pendingTs(), item };
}

export function blockcypherProvider(baseUrl: string, address: string, network: NetworkId): HistoryProvider {
  const source: HistorySource = {
    name: "utxo",
    async fetchPage(cursor: string | null, pageSize: number, ctx: SourceContext): Promise<SourcePage> {
      if (cursor !== null && !/^\d+$/.test(cursor)) throw new Error("Invalid cursor for blockcypher source.");
      const url =
        `${baseUrl}/addrs/${encodeURIComponent(address)}/full?limit=${pageSize}` +
        (cursor !== null ? `&before=${cursor}` : "");
      const res = await httpJson<BlockCypherAddressFull>(
        url,
        { method: "GET" },
        { ...ctx.http, label: "history.blockcypher" },
      );
      if (res.error) throw new Error(`blockcypher: ${res.error}`);
      const rows = res.txs ?? [];
      const items = rows.map((tx) => mapBlockCypherTx(tx, address, network)).filter((x): x is SourceItem => x !== null);
      const heights = rows
        .map((tx) => tx.block_height)
        .filter((h): h is number => typeof h === "number" && h > 0);
      // `before` is exclusive, so a page cut in the middle of a block would
      // skip the rest of that block. Re-include the oldest block instead; the
      // merge boundary drops the rows already emitted. When the whole page is
      // one block that would loop forever, so step past it in that case.
      const oldest = heights.length > 0 ? Math.min(...heights) : null;
      const newest = heights.length > 0 ? Math.max(...heights) : null;
      const next =
        res.hasMore && oldest !== null ? String(oldest === newest ? oldest : oldest + 1) : null;
      return { items, next };
    },
  };
  return { label: "blockcypher", sources: [source] };
}
