/**
 * Esplora REST API (blockstream.info, mempool.space, litecoinspace.org).
 * `/address/{a}/txs` returns mempool + the newest 25 confirmed transactions;
 * `/address/{a}/txs/chain/{last_seen_txid}` pages further. One source; the
 * page cursor is the last confirmed txid we saw. Direction and amount are
 * derived from the wallet's share of inputs and outputs.
 */

import type { NetworkId } from "../../../networks.js";
import { NATIVE_SYMBOL } from "../../balances.js";
import { httpJson } from "../../http.js";
import { amountOf, asString, feeOf, pendingTs, timeFrom, toBigInt } from "../normalize.js";
import type {
  HistoryItem,
  HistoryProvider,
  HistorySource,
  SourceContext,
  SourceItem,
  SourcePage,
} from "../types.js";

export interface EsploraTx {
  txid?: string;
  fee?: number;
  status?: { confirmed?: boolean; block_height?: number; block_time?: number };
  vin?: Array<{ prevout?: { scriptpubkey_address?: string; value?: number } | null; is_coinbase?: boolean }>;
  vout?: Array<{ scriptpubkey_address?: string; value?: number }>;
}

export interface UtxoIo {
  address: string | null;
  value: bigint;
}

/**
 * Wallet-relative view of a UTXO transaction. `sent` = value of our inputs,
 * `received` = value of our outputs. Out: amount = what left to others
 * (inputs − change − fee). In: amount = what we received.
 */
export function utxoSummary(
  inputs: UtxoIo[],
  outputs: UtxoIo[],
  address: string,
): Pick<HistoryItem, "direction" | "amount" | "from" | "to"> {
  const ours = (io: UtxoIo) => io.address === address;
  const sent = inputs.filter(ours).reduce((s, io) => s + io.value, 0n);
  const received = outputs.filter(ours).reduce((s, io) => s + io.value, 0n);
  const otherOutputs = outputs.filter((io) => !ours(io) && io.address);
  const otherInputs = inputs.filter((io) => !ours(io) && io.address);

  if (sent > 0n) {
    const toOthers = otherOutputs.reduce((s, io) => s + io.value, 0n);
    if (toOthers === 0n) {
      return { direction: "self", amount: amountOf(received, 8), from: address, to: address };
    }
    return {
      direction: "out",
      amount: amountOf(toOthers, 8),
      from: address,
      to: otherOutputs[0]?.address ?? null,
    };
  }
  return {
    direction: "in",
    amount: amountOf(received, 8),
    from: otherInputs[0]?.address ?? null,
    to: address,
  };
}

export function mapEsploraTx(tx: EsploraTx, address: string, network: NetworkId): SourceItem | null {
  const hash = asString(tx.txid);
  if (!hash) return null;
  const confirmed = tx.status?.confirmed === true;
  const time = confirmed ? timeFrom(tx.status?.block_time) : null;
  const inputs: UtxoIo[] = (tx.vin ?? []).map((v) => ({
    address: asString(v.prevout?.scriptpubkey_address),
    value: toBigInt(v.prevout?.value ?? 0),
  }));
  const outputs: UtxoIo[] = (tx.vout ?? []).map((v) => ({
    address: asString(v.scriptpubkey_address),
    value: toBigInt(v.value ?? 0),
  }));
  const feeRaw = toBigInt(tx.fee ?? 0);
  const summary = utxoSummary(inputs, outputs, address);
  const symbol = NATIVE_SYMBOL[network];
  const item: HistoryItem = {
    hash,
    timestamp: time?.iso ?? null,
    block: confirmed && typeof tx.status?.block_height === "number" ? tx.status.block_height : null,
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

export function esploraProvider(baseUrl: string, address: string, network: NetworkId): HistoryProvider {
  const label = /mempool\.space/i.test(baseUrl)
    ? "mempool.space"
    : /blockstream/i.test(baseUrl)
      ? "blockstream"
      : /litecoinspace/i.test(baseUrl)
        ? "litecoinspace"
        : "esplora";
  const source: HistorySource = {
    name: "utxo",
    async fetchPage(cursor: string | null, _pageSize: number, ctx: SourceContext): Promise<SourcePage> {
      const url =
        cursor === null
          ? `${baseUrl}/address/${encodeURIComponent(address)}/txs`
          : `${baseUrl}/address/${encodeURIComponent(address)}/txs/chain/${encodeURIComponent(cursor)}`;
      const rows = await httpJson<EsploraTx[]>(
        url,
        { method: "GET" },
        { ...ctx.http, label: "history.esplora" },
      );
      if (!Array.isArray(rows)) throw new Error("esplora: unexpected response");
      const items = rows.map((tx) => mapEsploraTx(tx, address, network)).filter((x): x is SourceItem => x !== null);
      // Esplora pages hold 25 confirmed txs; fewer means we reached the end.
      const confirmed = rows.filter((tx) => tx.status?.confirmed === true);
      const last = confirmed[confirmed.length - 1]?.txid;
      const next = confirmed.length < 25 || !last ? null : last;
      return { items, next };
    },
  };
  return { label, sources: [source] };
}
