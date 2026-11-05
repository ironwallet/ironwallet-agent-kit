/**
 * Primary endpoint plus profile fallbacks per network (`rpcFallbacks`). Every
 * caller only reads (balances, nonce, chain id, blockhash, fees), so a call
 * that fails on one host is repeated on the next. A host that failed goes to
 * the end of the list for a while, so later calls do not wait out its timeout.
 */

import { getConfig, isEvmNetwork, type Config, type NetworkId } from "../config.js";
import { errorDetails, logWarn } from "../log.js";

const HOST_DOWN_MS = 2 * 60 * 1000;

const downUntil = new Map<string, number>();

/** Test hook. */
export function clearEndpointHealth(): void {
  downUntil.clear();
}

export function primaryEndpoint(network: NetworkId, cfg: Config = getConfig()): string {
  if (isEvmNetwork(network)) {
    const url = cfg.evmRpcUrls[network];
    if (!url) throw new Error(`No RPC endpoint configured for ${network}.`);
    return url;
  }
  switch (network) {
    case "tron":
      return cfg.tronApiUrl;
    case "bitcoin":
      return cfg.bitcoinApiUrl;
    case "litecoin":
      return cfg.litecoinApiUrl;
    case "doge":
      return cfg.dogeApiUrl;
    case "solana":
      return cfg.solanaRpcUrl;
    case "ton":
      return cfg.tonApiUrl;
    case "xrp":
      return cfg.xrpRpcUrl;
    default:
      throw new Error(`No endpoint configured for ${network}.`);
  }
}

const trimSlash = (url: string) => url.replace(/\/+$/, "");

/** The primary first, then the fallbacks; hosts that recently failed go last. */
export function endpointsFor(network: NetworkId): string[] {
  const cfg = getConfig();
  const primary = primaryEndpoint(network, cfg);
  const seen = new Set([trimSlash(primary)]);
  const urls = [primary];
  for (const url of cfg.rpcFallbacks[network] ?? []) {
    if (seen.has(trimSlash(url))) continue;
    seen.add(trimSlash(url));
    urls.push(url);
  }
  const now = Date.now();
  const isDown = (url: string) => (downUntil.get(url) ?? 0) > now;
  return [...urls.filter((u) => !isDown(u)), ...urls.filter(isDown)];
}

const TRANSPORT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** JSON-RPC error codes nodes use for rate limits. */
const RPC_LIMIT_CODES = new Set([-32005, 429]);

/**
 * The host is at fault: unreachable, timed out, rate-limited, broken or on the
 * wrong chain. Anything else (bad address, reverted call, RPC error) would
 * repeat on another host.
 */
export function isHostFailure(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const err = e as Error & {
    kind?: string;
    status?: number;
    code?: unknown;
    error?: { code?: unknown };
    cause?: { code?: unknown };
  };
  // httpJson sets `kind` on timeouts and transport errors, rpc.ts on a chain mismatch.
  if (err.kind) return true;
  if (typeof err.status === "number") return err.status === 408 || err.status === 429 || err.status >= 500;
  if (typeof err.code === "string") {
    // ethers: TIMEOUT / NETWORK_ERROR, SERVER_ERROR for any non-2xx or a broken body.
    if (err.code === "TIMEOUT" || err.code === "NETWORK_ERROR" || err.code === "SERVER_ERROR") return true;
    if (TRANSPORT_CODES.has(err.code)) return true;
  }
  if (typeof err.error?.code === "number" && RPC_LIMIT_CODES.has(err.error.code)) return true;
  return typeof err.cause?.code === "string" && TRANSPORT_CODES.has(err.cause.code);
}

/**
 * Run `fn` against each endpoint of `network` until one succeeds. A request
 * error from the primary is final; fallbacks may serve only part of the API, so
 * their errors move on to the next host. Throws the primary's error when every
 * host fails.
 */
export async function withEndpoint<T>(network: NetworkId, fn: (url: string) => Promise<T>): Promise<T> {
  const primary = primaryEndpoint(network);
  const urls = endpointsFor(network);
  let primaryError: unknown;
  let firstError: unknown;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]!;
    try {
      return await fn(url);
    } catch (e) {
      const hostFailure = isHostFailure(e);
      if (url === primary) {
        if (!hostFailure) throw e;
        primaryError = e;
      }
      firstError ??= e;
      if (hostFailure) downUntil.set(url, Date.now() + HOST_DOWN_MS);
      if (i + 1 < urls.length) {
        logWarn("rpc.failover", { network, from: url, to: urls[i + 1], hostFailure, error: errorDetails(e) });
      }
    }
  }
  throw primaryError ?? firstError;
}
