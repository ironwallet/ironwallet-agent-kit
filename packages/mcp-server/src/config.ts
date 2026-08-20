/**
 * Runtime configuration: baked environment profile (from configurations repo),
 * plus optional env overrides. Relay API key and keystore passphrase are
 * generated on first launch. There is no runtime IW_ENV switch — each build
 * embeds one profile via the repo-root `npm run bake`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BAKED_ENV } from "./generated/env-config.js";
import {
  resolveDeviceId,
  resolveKeystoreDir,
  resolveKeystorePassphrase,
  resolveRelayApiKey,
} from "./local-secrets.js";

/** `package.json` version of this package (works from `src/` and compiled `dist/`). */
export function packageVersion(): string {
  try {
    const pkgPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Canonical network identifiers used across the server. */
export type NetworkId =
  | "ethereum"
  | "bsc"
  | "polygon"
  | "base"
  | "arbitrum"
  | "optimism"
  | "avalanche"
  | "tron"
  | "bitcoin"
  | "litecoin"
  | "doge"
  | "solana"
  | "ton"
  | "xrp";

/** Networks that share the secp256k1 EVM key and signing scheme. */
export const EVM_NETWORKS: NetworkId[] = [
  "ethereum",
  "bsc",
  "polygon",
  "base",
  "arbitrum",
  "optimism",
  "avalanche",
];

/** Non-EVM chains, each with its own curve / address scheme / node API. */
export const NON_EVM_NETWORKS: NetworkId[] = [
  "tron",
  "bitcoin",
  "litecoin",
  "doge",
  "solana",
  "ton",
  "xrp",
];

export const ALL_NETWORKS: NetworkId[] = [...EVM_NETWORKS, ...NON_EVM_NETWORKS];

/**
 * Networks advertised during challenge login. Kept to the proven EVM+Tron set:
 * the backend authenticates against these public keys and the flow is verified
 * for them. Newly added chains are used for address/balance reads and don't need
 * to be part of the auth handshake.
 */
export const AUTH_NETWORKS: NetworkId[] = [...EVM_NETWORKS, "tron"];

/**
 * Networks whose transfer signing is implemented (send is allowed). All of these
 * go through the Ironwallet relay forward flow (estimate → sign → forward),
 * including TON (IR-673 / mobile RelayV2).
 */
export const SIGNABLE_NETWORKS: NetworkId[] = [...ALL_NETWORKS];

export function canSend(network: NetworkId): boolean {
  return SIGNABLE_NETWORKS.includes(network);
}

/**
 * Networks that can sign swap txs (mobile NetType set). Litecoin/Doge are in
 * MCP for transfers but not in the mobile swap NetType enum.
 */
export const SWAP_SIGNABLE_NETWORKS: NetworkId[] = ALL_NETWORKS.filter(
  (n) => n !== "litecoin" && n !== "doge",
);

export function canSwap(network: NetworkId): boolean {
  return SWAP_SIGNABLE_NETWORKS.includes(network);
}

/** Parse a SWP network name ("Ethereum" / "ethereum") into NetworkId when known. */
export function parseNetworkId(name: string): NetworkId | undefined {
  const key = name.trim().toLowerCase();
  return ALL_NETWORKS.find((n) => n === key);
}

export function isEvmNetwork(network: NetworkId): boolean {
  return EVM_NETWORKS.includes(network);
}

/**
 * Relay path segment expected by the backend (PascalCase per network), e.g.
 * `https://iwio.app/txs/api/Ethereum/forward/estimate`.
 */
const RELAY_SEGMENT: Record<NetworkId, string> = {
  ethereum: "Ethereum",
  bsc: "Bsc",
  polygon: "Polygon",
  base: "Base",
  arbitrum: "Arbitrum",
  optimism: "Optimism",
  avalanche: "Avalanche",
  tron: "Tron",
  bitcoin: "Bitcoin",
  litecoin: "Litecoin",
  doge: "Doge",
  solana: "Solana",
  ton: "Ton",
  xrp: "Xrp",
};

export function relaySegment(network: NetworkId): string {
  return RELAY_SEGMENT[network];
}

export interface Config {
  authUrl: string;
  relayUrl: string;
  /** Swap Proxy host (`/swp/exchange/*`, `/swp/refs/*`). */
  swapProxyUrl: string;
  /** Optional relay API key (x-api-key). Empty string means header is omitted. */
  relayApiKey: string;
  /** App version string sent as x-iwt-cli / X-App-Version. */
  appVersion: string;
  /** Device id sent as X-Device-Id. UUID file under the keystore dir unless overridden. */
  deviceId: string;
  /** X-Device-Locale value, format: TimeZone=..;Language=..;Region=..; */
  deviceLocale: string;
  /**
   * JSON for `X-Device-Info`. Swap Proxy requires `systemName`
   * (e.g. `{"systemName":"iOS","systemVersion":"17.0","model":"iPhone"}`).
   */
  deviceInfo: string;
  /** Directory holding the encrypted keystore. */
  keystoreDir: string;
  /** JSON-RPC endpoints for EVM chains only. */
  evmRpcUrls: Record<string, string>;
  /** Tron full-node HTTP API base (TronGrid) for on-chain balance reads. */
  tronApiUrl: string;
  /** Bitcoin Esplora REST API base. */
  bitcoinApiUrl: string;
  /** Litecoin Esplora REST API base. */
  litecoinApiUrl: string;
  /** Dogecoin BlockCypher API base (…/v1/doge/main). */
  dogeApiUrl: string;
  /** Solana JSON-RPC endpoint. */
  solanaRpcUrl: string;
  /** TON HTTP API base (TON Center v2). */
  tonApiUrl: string;
  /** XRP Ledger JSON-RPC endpoint. */
  xrpRpcUrl: string;
  /** True when Bitcoin should use testnet (dev). */
  bitcoinTestnet: boolean;
  /** Per-attempt HTTP/RPC timeout in milliseconds. */
  httpTimeoutMs: number;
  /**
   * Timeout for relay `POST .../forward` (broadcast). Longer than the general
   * HTTP timeout because the relay may wait on chain inclusion before responding,
   * while the tx can already be in flight if the client gives up early.
   */
  httpForwardTimeoutMs: number;
  /** Extra retry attempts for idempotent requests (total tries = retries + 1). */
  httpRetries: number;
}

function envOr(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.length > 0 ? v : fallback;
}

/** Parse an integer env var, clamped to [min, max], falling back on invalid input. */
function envInt(key: string, fallback: number, min: number, max: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function resolveEvmRpcUrls(
  profileUrls: Record<string, string>,
): Record<string, string> {
  const urls: Record<string, string> = { ...profileUrls };
  for (const net of EVM_NETWORKS) {
    const override = process.env[`IW_RPC_${net.toUpperCase()}`];
    if (override) urls[net] = override;
  }
  return urls;
}

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached) return cached;
  resolveKeystorePassphrase();
  const profile = BAKED_ENV;
  cached = {
    authUrl: envOr("IW_AUTH_URL", profile.authUrl),
    relayUrl: envOr("IW_RELAY_URL", profile.relayUrl),
    swapProxyUrl: envOr("IW_SWAP_PROXY_URL", profile.swapProxyUrl),
    relayApiKey: resolveRelayApiKey(),
    appVersion: envOr("IW_APP_VERSION", `ironwallet-mcp/${packageVersion()}`),
    deviceId: resolveDeviceId(),
    deviceLocale: envOr("IW_DEVICE_LOCALE", "TimeZone=UTC;Language=en;Region=US;"),
    deviceInfo: envOr(
      "IW_DEVICE_INFO",
      JSON.stringify({
        systemName: "iOS",
        systemVersion: "17.0",
        model: "iPhone",
      }),
    ),
    keystoreDir: resolveKeystoreDir(),
    evmRpcUrls: resolveEvmRpcUrls(profile.evmRpcUrls),
    tronApiUrl: envOr("IW_TRON_API", profile.tronApiUrl),
    bitcoinApiUrl: envOr("IW_BTC_API", profile.bitcoinApiUrl),
    litecoinApiUrl: envOr("IW_LTC_API", profile.litecoinApiUrl),
    dogeApiUrl: envOr("IW_DOGE_API", profile.dogeApiUrl),
    solanaRpcUrl: envOr("IW_SOLANA_RPC", profile.solanaRpcUrl),
    tonApiUrl: envOr("IW_TON_API_URL", profile.tonApiUrl),
    xrpRpcUrl: envOr("IW_XRP_RPC", profile.xrpRpcUrl),
    bitcoinTestnet: profile.bitcoinTestnet,
    httpTimeoutMs: envInt("IW_HTTP_TIMEOUT_MS", 15000, 1000, 120000),
    // Forward can take well over 15s on L2s when the relay waits for broadcast /
    // inclusion; default 60s. Cap raised to 5 min so slow envs can override.
    httpForwardTimeoutMs: envInt("IW_HTTP_FORWARD_TIMEOUT_MS", 60000, 5000, 300000),
    httpRetries: envInt("IW_HTTP_RETRIES", 2, 0, 10),
  };
  return cached;
}

/** Common device-mimicking headers sent to auth, relay, and Swap Proxy. */
export function commonHeaders(cfg: Config): Record<string, string> {
  const headers: Record<string, string> = {
    "x-iwt-cli": cfg.appVersion,
    "X-App-Version": cfg.appVersion,
    "X-Device-Id": cfg.deviceId,
    // Backend validates the format: TimeZone=..;Language=..;Region=..;
    "X-Device-Locale": cfg.deviceLocale,
    // SWP validates UserData.XDeviceInfo — JSON with required `systemName`.
    "X-Device-Info": cfg.deviceInfo,
    "Content-Language": "en",
  };
  if (cfg.relayApiKey) headers["x-api-key"] = cfg.relayApiKey;
  return headers;
}
