/**
 * Public block-explorer links for a transaction, matching the mobile app's
 * production explorers except Tron, which links to tronscanner.org (it picks
 * the page language from the browser). Links only: nothing here is fetched by
 * the server.
 */

import { getConfig } from "../config.js";
import type { NetworkId } from "../networks.js";

const TX_URL: Record<NetworkId, string> = {
  ethereum: "https://etherscan.io/tx/",
  bsc: "https://bscscan.com/tx/",
  polygon: "https://polygonscan.com/tx/",
  base: "https://basescan.org/tx/",
  arbitrum: "https://arbiscan.io/tx/",
  optimism: "https://optimistic.etherscan.io/tx/",
  avalanche: "https://snowtrace.io/tx/",
  tron: "https://tronscanner.org/transactions/",
  bitcoin: "https://blockchair.com/bitcoin/transaction/",
  litecoin: "https://blockchair.com/litecoin/transaction/",
  doge: "https://blockchair.com/dogecoin/transaction/",
  solana: "https://explorer.solana.com/tx/",
  xrp: "https://xrpscan.com/tx/",
  ton: "https://tonscan.org/tx/",
};

export function explorerTxUrl(network: NetworkId, hash: string): string {
  const base =
    network === "bitcoin" && getConfig().bitcoinTestnet ? "https://blockchair.com/bitcoin/testnet/transaction/" : TX_URL[network];
  return base + encodeURIComponent(hash);
}
