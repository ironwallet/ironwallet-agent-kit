/** Shape of configurations/config.json baked at build time. */
export interface BakedEnvProfile {
  authUrl: string;
  relayUrl: string;
  swapProxyUrl: string;
  evmRpcUrls: Record<string, string>;
  tronApiUrl: string;
  bitcoinApiUrl: string;
  litecoinApiUrl: string;
  dogeApiUrl: string;
  solanaRpcUrl: string;
  tonApiUrl: string;
  xrpRpcUrl: string;
  bitcoinTestnet: boolean;
}
