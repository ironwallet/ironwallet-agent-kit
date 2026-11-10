/**
 * `/api/wallets/:id/history`: one page of a wallet's transactions on one
 * network, read from public explorers (same source as get_transaction_history)
 * and joined with the asset catalog for names and icons.
 */

import { createHash, randomUUID } from "node:crypto";
import { assetIconPath, isNetworkId, networkAssets, type Asset } from "../api/catalog.js";
import { explorerTxUrl } from "../api/explorers.js";
import { getTransactionHistory } from "../api/history/index.js";
import type { HistoryItem } from "../api/history/types.js";
import { loadKeystore, walletId } from "../keystore/store.js";
import { logInfo } from "../log.js";
import type { NetworkId } from "../networks.js";
import { HttpError } from "./api-util.js";
import { findWallet } from "./api-wallets.js";
import type { HistoryItemView, HistoryResponse } from "./contract.js";

const CURSOR_MAX = 2000;
const UNKNOWN_DISPLAY_DECIMALS = 6;

const trimZero = (amount: string) => amount.replace(/\.0$/, "");

/**
 * Zero-amount rows (spam token transfers, bare contract calls) are hidden like
 * in the mobile app. Explorers do not mark swaps, so zero swaps go too.
 */
const hasAmount = (it: HistoryItem) => !/^0*$/.test(it.amount.raw);

function itemId(it: HistoryItem): string {
  const key = [it.hash, it.asset.contractAddress ?? "", it.direction, it.amount.raw].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function catalogIndex(assets: Asset[]): (contract: string | null) => Asset | undefined {
  const byAddress = new Map(assets.filter((a) => a.address).map((a) => [a.address!.toLowerCase(), a]));
  const native = assets.find((a) => a.address === null);
  return (contract) => (contract === null ? native : byAddress.get(contract.toLowerCase()));
}

/** Other wallets on this machine by lower-cased address on `network`. */
function ownWallets(network: NetworkId, exceptId: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const w of loadKeystore().wallets) {
    const address = w.addresses[network];
    if (address && walletId(w) !== exceptId) out.set(address.toLowerCase(), w.name);
  }
  return out;
}

function view(
  network: NetworkId,
  it: HistoryItem,
  lookup: ReturnType<typeof catalogIndex>,
  wallets: Map<string, string>,
): HistoryItemView {
  const asset = lookup(it.asset.contractAddress);
  const counterparty = it.direction === "in" ? it.from : it.direction === "out" ? it.to : null;
  return {
    id: itemId(it),
    hash: it.hash,
    timestamp: it.timestamp,
    kind: it.kind,
    direction: it.direction,
    status: it.status,
    from: it.from,
    to: it.to,
    asset: {
      symbol: asset?.symbol ?? it.asset.symbol,
      assetId: asset?.assetId ?? null,
      name: asset?.name ?? null,
      standard: asset?.standard ?? null,
      icon: asset && assetIconPath(asset) ? `icons/${network}/${encodeURIComponent(asset.assetId)}` : null,
      displayDecimals: asset?.displayDecimals ?? UNKNOWN_DISPLAY_DECIMALS,
      ...(it.asset.warning ? { warning: it.asset.warning } : {}),
    },
    amount: trimZero(it.amount.formatted),
    fee: it.fee ? { amount: trimZero(it.fee.formatted), symbol: it.fee.symbol } : null,
    counterpartyWallet: counterparty ? (wallets.get(counterparty.toLowerCase()) ?? null) : null,
    explorerUrl: explorerTxUrl(network, it.hash),
  };
}

export async function walletHistory(id: string, params: URLSearchParams): Promise<HistoryResponse> {
  const entry = findWallet(id);
  const network = params.get("network") ?? "";
  if (!isNetworkId(network)) throw new HttpError(400, "bad_request", "Unknown network.");
  const address = entry.addresses[network];
  if (!address) throw new HttpError(404, "not_found", "This wallet has no address on that network.");
  const cursor = params.get("cursor") || undefined;
  if (cursor && cursor.length > CURSOR_MAX) throw new HttpError(400, "bad_request", "Invalid cursor.");

  const correlationId = randomUUID();
  const [result, assets] = await Promise.all([
    getTransactionHistory(network, address, { cursor, correlationId }).catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      if (/cursor/i.test(message)) throw new HttpError(400, "bad_request", "Invalid cursor.");
      throw e;
    }),
    networkAssets(network, correlationId).catch(() => [] as Asset[]),
  ]);
  const base = { network, address, items: [], nextCursor: null };
  if (result.status !== "ok") {
    logInfo("manager.history.empty", { correlationId, name: entry.name, network, status: result.status });
    return { ...base, status: result.status };
  }
  const lookup = catalogIndex(assets);
  const wallets = ownWallets(network, id);
  const shown = result.items.filter(hasAmount);
  logInfo("manager.history.ok", {
    correlationId,
    name: entry.name,
    network,
    items: shown.length,
    hiddenZero: result.items.length - shown.length,
  });
  return {
    ...base,
    status: "ok",
    items: shown.map((it) => view(network, it, lookup, wallets)),
    nextCursor: result.nextCursor,
  };
}
