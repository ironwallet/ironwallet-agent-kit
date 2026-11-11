/**
 * Batched balances for the wallet manager: one or two requests per network
 * instead of one per token.
 *   - EVM: Multicall3 `aggregate3` (native via `getEthBalance`, tokens via
 *     `balanceOf`) for the requested assets only.
 *   - Tron: TronGrid `/v1/accounts/<addr>` returns TRX and every TRC-20; for
 *     an address TronGrid does not know, `balanceOf` per requested token.
 *   - Solana: `getBalance` + `getTokenAccountsByOwner` for both token programs.
 *   - TON: native balance + TonCenter v3 jetton wallets of the owner.
 *   - UTXO chains and XRP: the native balance from balances.ts.
 * Account-wide sources report every catalog token they know, so the manager's
 * token list can show balances of hidden tokens on those networks for free.
 */

import { getAddress, Interface, type JsonRpcProvider } from "ethers";
import { Address } from "@ton/ton";
import { getConfig, isEvmNetwork } from "../config.js";
import type { NetworkId } from "../networks.js";
import { logInfo, logWarn } from "../log.js";
import type { Asset } from "./catalog.js";
import { getBalance, getTronTokenBalance } from "./balances.js";
import { withEndpoint } from "./endpoints.js";
import { httpJson, withoutRetries } from "./http.js";
import { tonApiKey, toncenterCall, trongridCall } from "./keyless.js";
import { withEvmProvider } from "./rpc.js";

/** Raw balances (smallest units) by `assetId`. Assets without an entry are unknown. */
export type BalanceMap = Map<string, bigint>;

/** Same address on every chain we support. */
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL_BATCH = 200;
const multicall = new Interface([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
  "function getEthBalance(address addr) view returns (uint256 balance)",
]);
const erc20 = new Interface(["function balanceOf(address owner) view returns (uint256)"]);

const SPL_PROGRAMS = [
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
];

function evmAddress(address: string): string | null {
  try {
    return getAddress(address.toLowerCase());
  } catch {
    return null;
  }
}

async function readEvm(network: NetworkId, owner: string, assets: Asset[]): Promise<BalanceMap> {
  return withEvmProvider(network, (provider) => multicallBalances(provider, owner, assets));
}

async function multicallBalances(provider: JsonRpcProvider, owner: string, assets: Asset[]): Promise<BalanceMap> {
  const holder = getAddress(owner);
  const calls: Array<{ assetId: string; target: string; callData: string }> = [];
  for (const a of assets) {
    if (a.address === null) {
      calls.push({
        assetId: a.assetId,
        target: MULTICALL3,
        callData: multicall.encodeFunctionData("getEthBalance", [holder]),
      });
      continue;
    }
    const target = evmAddress(a.address);
    if (target) {
      calls.push({ assetId: a.assetId, target, callData: erc20.encodeFunctionData("balanceOf", [holder]) });
    }
  }
  const out: BalanceMap = new Map();
  for (let i = 0; i < calls.length; i += MULTICALL_BATCH) {
    const chunk = calls.slice(i, i + MULTICALL_BATCH);
    const data = await provider.call({
      to: MULTICALL3,
      data: multicall.encodeFunctionData("aggregate3", [
        chunk.map((c) => ({ target: c.target, allowFailure: true, callData: c.callData })),
      ]),
    });
    const [results] = multicall.decodeFunctionResult("aggregate3", data) as unknown as [
      Array<{ success: boolean; returnData: string }>,
    ];
    results.forEach((r, j) => {
      if (r.success && r.returnData.length >= 66) out.set(chunk[j].assetId, BigInt(r.returnData.slice(0, 66)));
    });
  }
  return out;
}

interface TronGridAccounts {
  data?: Array<{ balance?: number; trc20?: Array<Record<string, string>> }>;
}

async function readTron(owner: string, wanted: Asset[], catalog: Asset[]): Promise<BalanceMap> {
  // /v1/accounts exists only on TronGrid; Tron fallbacks serve /wallet/* alone.
  const url = `${getConfig().tronApiUrl}/v1/accounts/${encodeURIComponent(owner)}`;
  const res = await trongridCall(() =>
    httpJson<TronGridAccounts>(url, { method: "GET" }, { label: "portfolio.tron", retries: 0 }),
  );
  const account = res?.data?.[0];
  if (!account) {
    // TronGrid has no record of an address that never received TRX, yet it can
    // still hold TRC-20 tokens.
    const out: BalanceMap = new Map();
    for (const a of wanted) {
      if (a.address === null) out.set(a.assetId, 0n);
      else out.set(a.assetId, await getTronTokenBalance(owner, a.address));
    }
    return out;
  }
  const tokens = new Map<string, string>();
  for (const entry of account.trc20 ?? []) {
    for (const [contract, amount] of Object.entries(entry)) tokens.set(contract, amount);
  }
  const out: BalanceMap = new Map();
  for (const a of catalog) {
    if (a.address === null) {
      out.set(a.assetId, BigInt(account.balance ?? 0));
      continue;
    }
    const amount = tokens.get(a.address);
    out.set(a.assetId, amount && /^\d+$/.test(amount) ? BigInt(amount) : 0n);
  }
  return out;
}

async function solanaRpc<T>(method: string, params: unknown): Promise<T> {
  return withEndpoint("solana", async (url) => {
    const res = await httpJson<{ result?: T; error?: { message?: string } }>(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      },
      { retry: true, label: "portfolio.solana" },
    );
    if (res.error) throw new Error(`Solana ${method} failed: ${res.error.message}`);
    return res.result as T;
  });
}

interface SplAccounts {
  value?: Array<{
    account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string } } } } };
  }>;
}

async function readSolana(owner: string, catalog: Asset[]): Promise<BalanceMap> {
  const [native, ...programs] = await Promise.all([
    solanaRpc<{ value?: number }>("getBalance", [owner, { commitment: "confirmed" }]),
    ...SPL_PROGRAMS.map((programId) =>
      solanaRpc<SplAccounts>("getTokenAccountsByOwner", [
        owner,
        { programId },
        { encoding: "jsonParsed", commitment: "confirmed" },
      ]),
    ),
  ]);
  const byMint = new Map<string, bigint>();
  for (const program of programs) {
    for (const item of program?.value ?? []) {
      const info = item.account?.data?.parsed?.info;
      const amount = info?.tokenAmount?.amount;
      if (!info?.mint || !amount || !/^\d+$/.test(amount)) continue;
      byMint.set(info.mint, (byMint.get(info.mint) ?? 0n) + BigInt(amount));
    }
  }
  const out: BalanceMap = new Map();
  for (const a of catalog) {
    out.set(a.assetId, a.address === null ? BigInt(native?.value ?? 0) : (byMint.get(a.address) ?? 0n));
  }
  return out;
}

function tonRaw(address: string): string | null {
  try {
    return Address.parse(address).toRawString();
  } catch {
    return null;
  }
}

interface ToncenterJettonWallets {
  jetton_wallets?: Array<{ jetton?: string; balance?: string }>;
}

async function readTon(owner: string, wanted: Asset[], catalog: Asset[]): Promise<BalanceMap> {
  const out: BalanceMap = new Map();
  const native = catalog.find((a) => a.address === null);
  const nativeBalance = await getBalance("ton", owner);
  if (native) out.set(native.assetId, BigInt(nativeBalance.raw));

  const base = getConfig().tonApiUrl.replace(/\/$/, "");
  if (!base.endsWith("/api/v2")) {
    for (const a of wanted) {
      if (a.address === null) continue;
      const jetton = await getBalance("ton", owner, a.address);
      out.set(a.assetId, BigInt(jetton.raw));
    }
    return out;
  }
  const key = tonApiKey();
  const res = await toncenterCall(() =>
    httpJson<ToncenterJettonWallets>(
      `${base.slice(0, -1)}3/jetton/wallets?owner_address=${encodeURIComponent(owner)}&limit=256&offset=0`,
      { method: "GET", headers: key ? { "X-Api-Key": key } : undefined },
      { label: "portfolio.ton", retries: 0 },
    ),
  );
  const byMaster = new Map<string, bigint>();
  for (const w of res?.jetton_wallets ?? []) {
    const master = w.jetton ? tonRaw(w.jetton) : null;
    if (!master || !w.balance || !/^\d+$/.test(w.balance)) continue;
    byMaster.set(master, (byMaster.get(master) ?? 0n) + BigInt(w.balance));
  }
  for (const a of catalog) {
    if (a.address === null) continue;
    const master = tonRaw(a.address);
    if (master) out.set(a.assetId, byMaster.get(master) ?? 0n);
  }
  return out;
}

async function readNative(network: NetworkId, owner: string, catalog: Asset[]): Promise<BalanceMap> {
  const native = catalog.find((a) => a.address === null);
  const out: BalanceMap = new Map();
  if (native) out.set(native.assetId, BigInt((await getBalance(network, owner)).raw));
  return out;
}

/**
 * Balances of `owner` on one network. `wanted` must be covered; the result may
 * also cover the rest of `catalog` when the source reports whole accounts.
 */
export async function readNetworkBalances(
  network: NetworkId,
  owner: string,
  wanted: Asset[],
  catalog: Asset[],
): Promise<BalanceMap> {
  if (isEvmNetwork(network)) return readEvm(network, owner, wanted);
  switch (network) {
    case "tron":
      return readTron(owner, wanted, catalog);
    case "solana":
      return readSolana(owner, catalog);
    case "ton":
      return readTon(owner, wanted, catalog);
    default:
      return readNative(network, owner, catalog);
  }
}

const BALANCE_TTL_MS = 30 * 1000;
const FAILURE_TTL_MS = 10 * 1000;
/**
 * A read must settle so the network leaves `pending` (ethers, for one, retries
 * a dead RPC's network detection forever).
 */
const READ_TIMEOUT_MS = 25 * 1000;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

interface Snapshot {
  at: number;
  covers: Set<string>;
  result: Promise<BalanceMap>;
  settled?: boolean;
  failed?: boolean;
}

const snapshots = new Map<string, Snapshot>();

function snapshotKey(network: NetworkId, owner: string): string {
  return `${network}|${owner}`;
}

/** Test hook. */
export function clearBalanceCache(): void {
  snapshots.clear();
}

/**
 * `readNetworkBalances` behind a short cache shared by every screen, so the
 * Wallets list, Home and the token list do not each hit the chain. Concurrent
 * callers share one in-flight read; a read that does not cover newly shown
 * tokens is replaced. No retries: a dead host fails within one HTTP timeout and
 * the next endpoint still fits in READ_TIMEOUT_MS. `refresh` skips a settled
 * snapshot but still joins a read in flight.
 */
export function cachedNetworkBalances(
  network: NetworkId,
  owner: string,
  wanted: Asset[],
  catalog: Asset[],
  refresh = false,
): Promise<BalanceMap> {
  const key = snapshotKey(network, owner);
  const hit = snapshots.get(key);
  const fresh =
    hit && (refresh ? !hit.settled : Date.now() - hit.at < (hit.failed ? FAILURE_TTL_MS : BALANCE_TTL_MS));
  if (hit && fresh && wanted.every((a) => hit.covers.has(a.assetId))) return hit.result;

  const started = Date.now();
  const snapshot: Snapshot = {
    at: started,
    covers: new Set(wanted.map((a) => a.assetId)),
    result: withTimeout(
      withoutRetries(() => readNetworkBalances(network, owner, wanted, catalog)),
      READ_TIMEOUT_MS,
      `${network} balances`,
    ),
  };
  snapshot.result.then(
    (map) => {
      snapshot.settled = true;
      for (const id of map.keys()) snapshot.covers.add(id);
      logInfo("portfolio.balances.ok", { network, owner, assets: map.size, elapsedMs: Date.now() - started });
    },
    (e) => {
      snapshot.settled = true;
      snapshot.failed = true;
      logWarn("portfolio.balances.fail", {
        network,
        owner,
        elapsedMs: Date.now() - started,
        error: e instanceof Error ? e.message : String(e),
      });
    },
  );
  snapshots.set(key, snapshot);
  return snapshot.result;
}
