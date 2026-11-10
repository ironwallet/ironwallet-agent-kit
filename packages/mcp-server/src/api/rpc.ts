/**
 * ethers JsonRpcProvider per EVM endpoint with a bounded per-request timeout,
 * behind the network's fallback list (endpoints.ts).
 *
 * ethers' default FetchRequest timeout is 5 minutes, which would let a stuck RPC
 * node hang balance reads and the signing nonce/chainId lookups indefinitely. We
 * cap it at the configured HTTP timeout and its 429 retries at ours.
 *
 * The chain id is read once per URL and handed to ethers: without it, ethers
 * detects the network in a background loop that retries every second and logs
 * to stdout (the MCP stdio channel) for as long as the host is down. All hosts
 * of a network must report the same chain id.
 */

import { FetchRequest, JsonRpcProvider, Network } from "ethers";
import { getConfig, type NetworkId } from "../config.js";
import { primaryEndpoint, withEndpoint } from "./endpoints.js";
import { httpJson } from "./http.js";

const providers = new Map<string, Promise<JsonRpcProvider>>();
const chainIds = new Map<NetworkId, bigint>();

/** Test hook. */
export function clearProviderCache(): void {
  providers.clear();
  chainIds.clear();
}

async function readChainId(url: string): Promise<bigint> {
  const res = await httpJson<{ result?: string; error?: { message?: string } }>(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    },
    { retry: true, label: "rpc.chain_id" },
  );
  if (!res?.result) throw new Error(`eth_chainId failed at ${url}: ${res?.error?.message ?? "no result"}`);
  return BigInt(res.result);
}

async function createProvider(network: NetworkId, url: string): Promise<JsonRpcProvider> {
  const chainId = await readChainId(url);
  const expected = chainIds.get(network);
  if (expected !== undefined && expected !== chainId) {
    const err = new Error(`${url} serves chain ${chainId}, expected ${expected} for ${network}.`) as Error & {
      kind?: string;
    };
    err.kind = "wrong_chain";
    throw err;
  }
  if (expected === undefined || url === primaryEndpoint(network)) chainIds.set(network, chainId);

  const cfg = getConfig();
  const req = new FetchRequest(url);
  req.timeout = cfg.httpTimeoutMs;
  req.setThrottleParams({ maxAttempts: cfg.httpRetries + 1 });
  const net = Network.from(chainId);
  return new JsonRpcProvider(req, net, { staticNetwork: net });
}

function providerAt(network: NetworkId, url: string): Promise<JsonRpcProvider> {
  let provider = providers.get(url);
  if (!provider) {
    provider = createProvider(network, url);
    providers.set(url, provider);
    provider.catch(() => providers.delete(url));
  }
  return provider;
}

/**
 * Run `fn` with a provider for the first healthy endpoint of `network`. Reads
 * that must agree (chain id and nonce for one signature) belong in one `fn`.
 */
export function withEvmProvider<T>(network: NetworkId, fn: (provider: JsonRpcProvider) => Promise<T>): Promise<T> {
  return withEndpoint(network, async (url) => fn(await providerAt(network, url)));
}
