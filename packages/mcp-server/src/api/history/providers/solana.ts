/**
 * Solana JSON-RPC: getSignaturesForAddress → one batched getTransaction call
 * (jsonParsed). Amounts are the wallet's lamport / token balance deltas from
 * the transaction meta, so swaps and program interactions show what actually
 * left or arrived. Cursor = last signature (`before`). Memos are deliberately
 * not surfaced: they are free-form text from strangers.
 */

import { httpJson } from "../../http.js";
import { amountOf, asString, feeOf, pendingTs, sanitizeSymbol, timeFrom, toBigInt } from "../normalize.js";
import type {
  HistoryItem,
  HistoryProvider,
  HistorySource,
  SourceContext,
  SourceItem,
  SourcePage,
} from "../types.js";

interface SignatureInfo {
  signature?: string;
  slot?: number;
  blockTime?: number | null;
  err?: unknown;
}

interface TokenBalance {
  accountIndex?: number;
  mint?: string;
  owner?: string;
  uiTokenAmount?: { amount?: string; decimals?: number };
}

export interface SolanaTx {
  slot?: number;
  blockTime?: number | null;
  meta?: {
    err?: unknown;
    fee?: number;
    preBalances?: number[];
    postBalances?: number[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
  } | null;
  transaction?: {
    message?: { accountKeys?: Array<{ pubkey?: string; signer?: boolean } | string> };
  };
}

interface RpcResponse<T> {
  id?: number;
  result?: T;
  error?: { message?: string };
}

function keyOf(entry: { pubkey?: string } | string | undefined): string | null {
  if (typeof entry === "string") return entry;
  return asString(entry?.pubkey);
}

/** Wallet-relative items for one transaction (one per asset that moved). */
export function mapSolanaTx(signature: string, tx: SolanaTx | null, info: SignatureInfo, address: string): SourceItem[] {
  const time = timeFrom(tx?.blockTime ?? info.blockTime ?? undefined);
  const ts = time?.ts ?? pendingTs();
  const failed = (tx?.meta?.err ?? info.err) != null;
  const base = {
    hash: signature,
    timestamp: time?.iso ?? null,
    block: typeof (tx?.slot ?? info.slot) === "number" ? ((tx?.slot ?? info.slot) as number) : null,
    status: failed ? ("failed" as const) : ("confirmed" as const),
  };

  const meta = tx?.meta;
  const keys = (tx?.transaction?.message?.accountKeys ?? []).map(keyOf);
  const selfIndex = keys.indexOf(address);
  if (!meta || selfIndex === -1) {
    return [
      {
        ts,
        item: {
          ...base,
          kind: "other",
          direction: "in",
          from: null,
          to: address,
          asset: { symbol: "SOL", contractAddress: null, decimals: 9 },
          amount: amountOf(0n, 9),
          fee: null,
        },
      },
    ];
  }

  const feePayer = keys[0] === address;
  const fee = toBigInt(meta.fee ?? 0);
  const feeInfo = feePayer ? feeOf(fee, 9, "SOL") : null;
  const items: SourceItem[] = [];

  // SPL deltas for token accounts owned by this wallet, per mint.
  const tokenDelta = new Map<string, { delta: bigint; decimals: number }>();
  const addTokens = (balances: TokenBalance[] | undefined, sign: 1n | -1n) => {
    for (const b of balances ?? []) {
      if (b.owner !== address || !b.mint) continue;
      const amount = toBigInt(b.uiTokenAmount?.amount ?? "0") * sign;
      const prev = tokenDelta.get(b.mint) ?? { delta: 0n, decimals: b.uiTokenAmount?.decimals ?? 0 };
      tokenDelta.set(b.mint, { delta: prev.delta + amount, decimals: prev.decimals });
    }
  };
  addTokens(meta.preTokenBalances, -1n);
  addTokens(meta.postTokenBalances, 1n);

  // Counterparty owners for the same mint (opposite sign).
  const ownerDeltaByMint = new Map<string, Map<string, bigint>>();
  const addOwners = (balances: TokenBalance[] | undefined, sign: 1n | -1n) => {
    for (const b of balances ?? []) {
      if (!b.mint || !b.owner || b.owner === address) continue;
      const byOwner = ownerDeltaByMint.get(b.mint) ?? new Map<string, bigint>();
      byOwner.set(b.owner, (byOwner.get(b.owner) ?? 0n) + toBigInt(b.uiTokenAmount?.amount ?? "0") * sign);
      ownerDeltaByMint.set(b.mint, byOwner);
    }
  };
  addOwners(meta.preTokenBalances, -1n);
  addOwners(meta.postTokenBalances, 1n);

  for (const [mint, { delta, decimals }] of tokenDelta) {
    if (delta === 0n) continue;
    const direction = delta < 0n ? "out" : "in";
    let counterparty: string | null = null;
    let best = 0n;
    for (const [owner, d] of ownerDeltaByMint.get(mint) ?? []) {
      if (direction === "out" ? d > best : d < best) {
        best = d;
        counterparty = owner;
      }
    }
    items.push({
      ts,
      item: {
        ...base,
        kind: "token_transfer",
        direction,
        from: direction === "out" ? address : counterparty,
        to: direction === "out" ? counterparty : address,
        asset: { symbol: sanitizeSymbol(null, "SPL"), contractAddress: mint, decimals },
        amount: amountOf(delta, decimals),
        fee: items.length === 0 && direction === "out" ? feeInfo : null,
      },
    });
  }

  const pre = toBigInt(meta.preBalances?.[selfIndex] ?? 0);
  const post = toBigInt(meta.postBalances?.[selfIndex] ?? 0);
  const solDelta = post - pre + (feePayer ? fee : 0n);
  if (solDelta !== 0n) {
    const direction = solDelta < 0n ? "out" : "in";
    let counterparty: string | null = null;
    let best = 0n;
    keys.forEach((key, i) => {
      if (!key || i === selfIndex) return;
      const d = toBigInt(meta.postBalances?.[i] ?? 0) - toBigInt(meta.preBalances?.[i] ?? 0);
      if (direction === "out" ? d > best : d < best) {
        best = d;
        counterparty = key;
      }
    });
    items.push({
      ts,
      item: {
        ...base,
        kind: "transfer",
        direction,
        from: direction === "out" ? address : counterparty,
        to: direction === "out" ? counterparty : address,
        asset: { symbol: "SOL", contractAddress: null, decimals: 9 },
        amount: amountOf(solDelta, 9),
        fee: items.length === 0 && direction === "out" ? feeInfo : null,
      },
    });
  }

  if (items.length === 0) {
    items.push({
      ts,
      item: {
        ...base,
        kind: "contract_call",
        direction: feePayer ? "out" : "in",
        from: feePayer ? address : keys[0] ?? null,
        to: feePayer ? null : address,
        asset: { symbol: "SOL", contractAddress: null, decimals: 9 },
        amount: amountOf(0n, 9),
        fee: feeInfo,
      },
    });
  }
  return items;
}

const TX_CONCURRENCY = 5;

export function solanaProvider(rpcUrl: string, address: string): HistoryProvider {
  const label = /publicnode/i.test(rpcUrl) ? "solana-publicnode" : "solana-rpc";
  const source: HistorySource = {
    name: "sol",
    async fetchPage(cursor: string | null, pageSize: number, ctx: SourceContext): Promise<SourcePage> {
      const opts = { ...ctx.http, retry: true };
      const sigRes = await httpJson<RpcResponse<SignatureInfo[]>>(
        rpcUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getSignaturesForAddress",
            params: [address, { limit: pageSize, ...(cursor ? { before: cursor } : {}) }],
          }),
        },
        { ...opts, label: "history.solana.signatures" },
      );
      if (sigRes.error) throw new Error(`solana getSignaturesForAddress: ${sigRes.error.message}`);
      const infos = (sigRes.result ?? []).filter((s) => typeof s.signature === "string");
      if (infos.length === 0) return { items: [], next: null };

      // One getTransaction per request with bounded concurrency: publicnode
      // rejects batches with more than one getTransaction, and mainnet-beta
      // answers big batches with per-item 429s. Any failed detail fails the
      // page (→ next RPC in the chain) instead of degrading rows to "other".
      const details: Array<SolanaTx | null> = new Array(infos.length).fill(null);
      let nextIndex = 0;
      const worker = async (): Promise<void> => {
        for (;;) {
          const i = nextIndex++;
          if (i >= infos.length) return;
          const res = await httpJson<RpcResponse<SolanaTx | null>>(
            rpcUrl,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: i,
                method: "getTransaction",
                params: [
                  infos[i].signature,
                  { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
                ],
              }),
            },
            { ...opts, retries: 0, label: "history.solana.transaction" },
          );
          if (res.error) throw new Error(`solana getTransaction: ${res.error.message}`);
          details[i] = res.result ?? null;
        }
      };
      await Promise.all(Array.from({ length: Math.min(TX_CONCURRENCY, infos.length) }, worker));

      const items: SourceItem[] = [];
      infos.forEach((info, i) => {
        items.push(...mapSolanaTx(info.signature as string, details[i], info, address));
      });
      const last = infos[infos.length - 1].signature as string;
      return { items, next: infos.length < pageSize ? null : last };
    },
  };
  return { label, sources: [source] };
}
