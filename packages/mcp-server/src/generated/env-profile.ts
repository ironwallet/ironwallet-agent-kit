import type { HistoryApis } from "../api/history/types.js";

/** Shape of configurations/config.json baked at build time. */
export interface BakedEnvProfile {
  authUrl: string;
  relayUrl: string;
  swapProxyUrl: string;
  /** Rates API host (`/api/v1/rate/*`). Optional until configurations ships it. */
  ratesApiUrl?: string;
  /** Static resources base for asset catalogs (`/assets/main/blockchains/...`). */
  staticResourcesUrl?: string;
  evmRpcUrls: Record<string, string>;
  tronApiUrl: string;
  bitcoinApiUrl: string;
  litecoinApiUrl: string;
  dogeApiUrl: string;
  solanaRpcUrl: string;
  tonApiUrl: string;
  xrpRpcUrl: string;
  bitcoinTestnet: boolean;
  /**
   * Transaction-history indexers per network, tried in order. Optional: non-EVM
   * networks fall back to the endpoints above; EVM networks without an entry
   * report history as unsupported.
   */
  historyApis?: HistoryApis;
}
