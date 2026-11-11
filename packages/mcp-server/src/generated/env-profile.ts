import type { HistoryApis } from "../api/history/types.js";

/** Shape of configurations/config.json baked at build time. */
export interface BakedEnvProfile {
  authUrl: string;
  relayUrl: string;
  swapProxyUrl: string;
  /** Rates API host (`/api/v1/rate/*`). Optional until configurations ships it. */
  ratesApiUrl?: string;
  /** MCP proxy base for asset catalogs (`/assets/<branch>/blockchains/...`); fallback after the CDNs. */
  staticResourcesUrl?: string;
  /** Public CDN bases for the same static resources, tried in order first. */
  staticCdnUrls?: string[];
  /** Static resources branch (`main` / `staging`). Default `main`. */
  staticAssetsBranch?: string;
  evmRpcUrls: Record<string, string>;
  tronApiUrl: string;
  bitcoinApiUrl: string;
  litecoinApiUrl: string;
  dogeApiUrl: string;
  solanaRpcUrl: string;
  tonApiUrl: string;
  xrpRpcUrl: string;
  /** Fallback endpoints per network (not TON), same API as the primary field. Optional. */
  rpcFallbacks?: Partial<Record<string, string[]>>;
  bitcoinTestnet: boolean;
  /**
   * Transaction-history indexers per network, tried in order. Optional: non-EVM
   * networks fall back to the endpoints above; EVM networks without an entry
   * report history as unsupported.
   */
  historyApis?: HistoryApis;
}
