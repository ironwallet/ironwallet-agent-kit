/**
 * Shared ethers JsonRpcProvider factory with a bounded per-request timeout.
 *
 * ethers' default FetchRequest timeout is 5 minutes, which would let a stuck RPC
 * node hang balance reads and the signing nonce/chainId lookups indefinitely. We
 * cap it at the configured HTTP timeout and cache one provider per URL.
 */

import { FetchRequest, JsonRpcProvider } from "ethers";
import { getConfig, type NetworkId } from "../config.js";

const providerCache = new Map<string, JsonRpcProvider>();

export function providerFor(network: NetworkId): JsonRpcProvider {
  const cfg = getConfig();
  const url = cfg.evmRpcUrls[network];
  if (!url) throw new Error(`No RPC endpoint configured for ${network}.`);

  let provider = providerCache.get(url);
  if (!provider) {
    const req = new FetchRequest(url);
    req.timeout = cfg.httpTimeoutMs;
    // Assume a stable chain id so ethers doesn't re-detect the network on every call.
    provider = new JsonRpcProvider(req, undefined, { staticNetwork: true });
    providerCache.set(url, provider);
  }
  return provider;
}
