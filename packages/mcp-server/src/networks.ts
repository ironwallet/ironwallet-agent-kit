/** Canonical network identifiers used across the server. No baked env. */

export const EVM_NETWORKS = [
  "ethereum",
  "bsc",
  "polygon",
  "base",
  "arbitrum",
  "optimism",
  "avalanche",
] as const;

export const NON_EVM_NETWORKS = [
  "tron",
  "bitcoin",
  "litecoin",
  "doge",
  "solana",
  "ton",
  "xrp",
] as const;

export const ALL_NETWORKS = [...EVM_NETWORKS, ...NON_EVM_NETWORKS] as const;

export type NetworkId = (typeof ALL_NETWORKS)[number];
