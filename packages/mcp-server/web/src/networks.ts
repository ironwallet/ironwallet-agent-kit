import arbitrum from "./assets/networks/arbitrum.svg";
import avalanche from "./assets/networks/avalanche.svg";
import base from "./assets/networks/base.svg";
import bitcoin from "./assets/networks/bitcoin.svg";
import bnb from "./assets/networks/bnb.svg";
import ethereum from "./assets/networks/ethereum.svg";
import optimism from "./assets/networks/optimism.svg";
import polygon from "./assets/networks/polygon.svg";
import solana from "./assets/networks/solana.svg";
import ton from "./assets/networks/ton.svg";
import tron from "./assets/networks/tron.svg";
import xrp from "./assets/networks/xrp.svg";

/** Chip / filter order: the design's first chips, then the rest of the server's networks. */
export const NETWORK_ORDER = [
  "ethereum",
  "bitcoin",
  "bsc",
  "tron",
  "avalanche",
  "polygon",
  "solana",
  "ton",
  "base",
  "arbitrum",
  "optimism",
  "xrp",
  "litecoin",
  "doge",
] as const;

const NAMES: Record<string, string> = {
  ethereum: "Ethereum",
  bitcoin: "Bitcoin",
  bsc: "BNB Chain",
  tron: "TRON",
  avalanche: "Avalanche",
  polygon: "Polygon",
  solana: "Solana",
  ton: "TON",
  base: "Base",
  arbitrum: "Arbitrum",
  optimism: "Optimism",
  xrp: "XRP",
  litecoin: "Litecoin",
  doge: "Dogecoin",
};

/** Network logos from the mobile app; Litecoin and Dogecoin fall back to the coin icon. */
const LOGOS: Record<string, string> = {
  arbitrum,
  avalanche,
  base,
  bitcoin,
  bsc: bnb,
  ethereum,
  optimism,
  polygon,
  solana,
  ton,
  tron,
  xrp,
};

export function networkName(network: string): string {
  return NAMES[network] ?? network;
}

export function networkLogo(network: string): string | undefined {
  return LOGOS[network];
}

/** Networks the wallet has an address on, in chip order. */
export function walletNetworks(addresses: Record<string, string>): string[] {
  return NETWORK_ORDER.filter((n) => addresses[n]);
}
