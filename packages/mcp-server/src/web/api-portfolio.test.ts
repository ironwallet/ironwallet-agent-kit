/**
 * Portfolio, token list, token visibility and icons of the manager API. The
 * catalog, rates and chain endpoints are a local mock: Ethereum answers
 * Multicall3, Tron answers TronGrid `/v1/accounts` and `triggerconstantcontract`,
 * Litecoin can be held open to play a slow host, every other chain fails.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Interface } from "ethers";
import { EVM_NETWORKS } from "../networks.js";
import type { PortfolioResponse, TokensResponse, WalletResponse } from "./contract.js";

const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
const USDT_ETH = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDT_TRON = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);

const CATALOGS: Record<string, unknown> = {
  ethereum: {
    assets: [
      { asset_id: "eth1", symbol: "ETH", name: "ETH", decimals: 18, default: true, externalId: "ethereum", logoUri: "assets/eth1/logo.png" },
      { asset_id: "usdt1", address: USDT_ETH, symbol: "USDT", name: "Tether", decimals: 6, default: true, type: "ERC20", externalId: "tether", logoUri: "assets/usdt1/logo.png" },
      { asset_id: "weth1", address: WETH, symbol: "WETH", name: "Wrapped ETH", decimals: 18, default: false, type: "ERC20", externalId: "weth" },
    ],
  },
  tron: {
    assets: [
      { asset_id: "trx1", symbol: "TRX", name: "TRX", decimals: 6, default: true, externalId: "tron" },
      { asset_id: "usdt2", address: USDT_TRON, symbol: "usdt", name: "Tether", decimals: 6, default: true, type: "TRC20", externalId: "tether" },
    ],
  },
};

const RATES: Record<string, { value: number; dailyChange: number }> = {
  ethereum: { value: 2000, dailyChange: 1.5 },
  tether: { value: 1, dailyChange: 0 },
  tron: { value: 0.25, dailyChange: -2 },
};

const multicall = new Interface([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
]);
const word = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;

function aggregate3(data: string): string {
  const [calls] = multicall.decodeFunctionData("aggregate3", data) as unknown as [Array<{ target: string }>];
  const results = calls.map((c) => {
    const target = c.target.toLowerCase();
    if (target === MULTICALL3) return [true, word(1_500_000_000_000_000_000n)];
    if (target === USDT_ETH.toLowerCase()) return [true, word(25_000_000n)];
    return [true, word(0n)];
  });
  return multicall.encodeFunctionResult("aggregate3", [results]);
}

type RpcRequest = { id: number; method: string; params: Array<{ data?: string }> };

function rpcReply(network: string, req: RpcRequest): unknown {
  if (req.method === "eth_chainId") return { jsonrpc: "2.0", id: req.id, result: "0x1" };
  if (network === "ethereum" && req.method === "eth_call") {
    return { jsonrpc: "2.0", id: req.id, result: aggregate3(req.params[0].data ?? "0x") };
  }
  return { jsonrpc: "2.0", id: req.id, error: { code: -32000, message: "node down" } };
}

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

let mock: Server;
let tronActivated = true;
const tronConstantCalls: string[] = [];
let ltcSlow = false;
let ltcRequests = 0;
const heldLtc: Array<() => void> = [];

function releaseLtc(): void {
  for (const answer of heldLtc.splice(0)) answer();
}

let tronCatalogSlow = false;
let ratesSlow = false;
const held: Array<() => void> = [];

function releaseHeld(): void {
  for (const answer of held.splice(0)) answer();
}
const dir = mkdtempSync(join(tmpdir(), "iw-manager-portfolio-"));

async function startMock(): Promise<string> {
  mock = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    const catalog = /^\/static\/assets\/main\/blockchains\/([a-z]+)\/assets\.mainnet\.json$/.exec(url.pathname);
    if (catalog) {
      const reply = () => (CATALOGS[catalog[1]] ? json(200, CATALOGS[catalog[1]]) : json(404, {}));
      if (catalog[1] === "tron" && tronCatalogSlow) return void held.push(reply);
      return reply();
    }
    if (url.pathname === "/static/assets/main/blockchains/ethereum/assets/eth1/logo.png") {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(PNG);
    }
    if (url.pathname === "/static/assets/main/blockchains/ethereum/assets/usdt1/logo.png") {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end("<html>not an image</html>");
    }
    if (url.pathname === "/rates/api/v1/rate/rates") {
      const ids = (url.searchParams.get("Ids") ?? "").split(",");
      const reply = () => json(200, Object.fromEntries(ids.filter((id) => RATES[id]).map((id) => [id, { usd: RATES[id] }])));
      if (ratesSlow) return void held.push(reply);
      return reply();
    }
    const evm = /^\/evm\/([a-z]+)$/.exec(url.pathname);
    if (evm && req.method === "POST") {
      const parsed = JSON.parse(await body(req)) as RpcRequest | RpcRequest[];
      return json(200, Array.isArray(parsed) ? parsed.map((r) => rpcReply(evm[1], r)) : rpcReply(evm[1], parsed));
    }
    if (url.pathname.startsWith("/tron/v1/accounts/")) {
      if (!tronActivated) return json(200, { data: [], success: true });
      return json(200, { data: [{ balance: 2_000_000, trc20: [{ [USDT_TRON]: "7000000" }] }], success: true });
    }
    if (url.pathname === "/tron/wallet/triggerconstantcontract" && req.method === "POST") {
      const call = JSON.parse(await body(req)) as { contract_address: string; function_selector: string };
      tronConstantCalls.push(call.contract_address);
      const known = call.contract_address === USDT_TRON && call.function_selector === "balanceOf(address)";
      return json(200, { constant_result: [known ? word(6_000_000n).slice(2) : word(0n).slice(2)] });
    }
    if (url.pathname.startsWith("/ltc/address/") && ltcSlow) {
      ltcRequests++;
      heldLtc.push(() => json(200, { chain_stats: { funded_txo_sum: 150_000_000, spent_txo_sum: 0 }, mempool_stats: {} }));
      return;
    }
    json(400, { error: "not mocked" });
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
}

const mockBase = await startMock();
process.env.IW_KEYSTORE_DIR = dir;
process.env.IW_PASSPHRASE = "test-passphrase-not-secret";
process.env.IW_LOG_FILE = "";
process.env.IW_HTTP_RETRIES = "0";
process.env.IW_STATIC_RESOURCES_URL = `${mockBase}/static`;
process.env.IW_STATIC_CDN_URLS = `${mockBase}/static`;
process.env.IW_STATIC_ASSETS_BRANCH = "main";
process.env.IW_RATES_API_URL = `${mockBase}/rates`;
process.env.IW_TRON_API = `${mockBase}/tron`;
for (const net of EVM_NETWORKS) process.env[`IW_RPC_${net.toUpperCase()}`] = `${mockBase}/evm/${net}`;
for (const key of ["IW_BTC_API", "IW_DOGE_API", "IW_SOLANA_RPC", "IW_XRP_RPC"]) {
  process.env[key] = `${mockBase}/down`;
}
process.env.IW_LTC_API = `${mockBase}/ltc`;
process.env.IW_TON_API_URL = `${mockBase}/ton/api/v2`;

const { ensureManager, closeManager } = await import("./manager.js");
const { clearBalanceCache } = await import("../api/portfolio.js");
const { setPartialWaitMs } = await import("./api-portfolio.js");
const { clearCatalogCache, fetchCatalog } = await import("../api/catalog.js");
const { expireRatesCache } = await import("../api/rates.js");

let base = "";
let origin = "";
let walletId = "";

before(async () => {
  base = await ensureManager();
  origin = new URL(base).origin;
  await send("POST", "/consent", { understood: true });
  const created = (await (await send("POST", "/wallets", { name: "Main" })).json()) as WalletResponse;
  walletId = created.wallet.id;
});

after(() => {
  releaseLtc();
  releaseHeld();
  closeManager();
  mock.close();
  rmSync(dir, { recursive: true, force: true });
});

function send(method: string, sub: string, payload?: unknown) {
  return fetch(`${base}/api${sub}`, {
    method,
    headers: payload === undefined ? undefined : { "content-type": "application/json", origin },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

async function portfolio(refresh = false): Promise<PortfolioResponse> {
  const r = await send("GET", `/wallets/${walletId}/portfolio${refresh ? "?refresh=1" : ""}`);
  assert.equal(r.status, 200);
  return (await r.json()) as PortfolioResponse;
}

/** Asks again the way the page polls, until `done` or a few tries pass. */
async function pollUntil(done: (p: PortfolioResponse) => boolean): Promise<PortfolioResponse> {
  let p = await portfolio();
  for (let i = 0; i < 10 && !done(p); i++) p = await portfolio();
  assert.ok(done(p), `still loading: ${JSON.stringify({ pending: p.pending, ratesPending: p.ratesPending })}`);
  return p;
}

test("the portfolio values default tokens and names the networks that failed", async () => {
  const p = await portfolio();
  const byKey = new Map(p.tokens.map((t) => [t.key, t]));

  const eth = byKey.get("ethereum:eth1")!;
  assert.equal(eth.balance, "1.5");
  assert.equal(eth.usdValue, 3000);
  assert.equal(eth.change24h, 1.5);
  assert.equal(eth.standard, null);
  assert.equal(eth.icon, "icons/ethereum/eth1");

  const usdt = byKey.get("ethereum:usdt1")!;
  assert.equal(usdt.balance, "25");
  assert.equal(usdt.standard, "ERC20");
  assert.equal(byKey.get("tron:trx1")?.balance, "2");
  assert.equal(byKey.get("tron:usdt2")?.symbol, "USDT");
  assert.equal(byKey.get("tron:usdt2")?.balance, "7");
  assert.equal(byKey.has("ethereum:weth1"), false);

  assert.equal(p.totalUsd, 3000 + 25 + 0.5 + 7);
  const failed = p.errors.map((e) => e.network);
  assert.ok(failed.includes("bitcoin") && failed.includes("ton") && failed.includes("bsc"));
  assert.ok(!failed.includes("ethereum") && !failed.includes("tron"));
  assert.equal(byKey.get("bitcoin:native")?.balance, null);
  assert.deepEqual(p.pending, []);
  assert.equal(p.ratesPending, false);
  assert.equal(JSON.stringify(p).includes(mockBase), false);
});

test("a slow network comes back pending, not failed, and the next request picks up the same read", async () => {
  ltcSlow = true;
  ltcRequests = 0;
  clearBalanceCache();
  setPartialWaitMs(300);
  try {
    const first = await portfolio();
    assert.ok(first.pending.includes("litecoin"));
    assert.ok(!first.errors.some((e) => e.network === "litecoin"));
    const byKey = new Map(first.tokens.map((t) => [t.key, t]));
    assert.equal(byKey.get("litecoin:native")?.balance, null);
    assert.equal(byKey.get("ethereum:eth1")?.balance, "1.5");

    const list = (await (await send("GET", `/wallets/${walletId}/tokens?network=litecoin`)).json()) as TokensResponse;
    assert.deepEqual(list.pending, ["litecoin"]);
    assert.deepEqual(list.errors, []);

    releaseLtc();
    const second = await portfolio();
    assert.ok(!second.pending.includes("litecoin"));
    assert.equal(second.tokens.find((t) => t.key === "litecoin:native")?.balance, "1.5");
    assert.equal(ltcRequests, 1);
  } finally {
    ltcSlow = false;
    releaseLtc();
    setPartialWaitMs();
    clearBalanceCache();
  }
});

test("a catalog that is slow on first load leaves its network pending, not the whole page", async () => {
  // Only Tron is cold: Ethereum's catalog and balance are in hand, so a busy
  // test runner cannot push it past the 300ms wait as well.
  await portfolio();
  clearCatalogCache();
  await fetchCatalog("ethereum");
  tronCatalogSlow = true;
  setPartialWaitMs(300);
  try {
    const started = Date.now();
    const first = await portfolio();
    assert.ok(Date.now() - started < 2000);
    assert.ok(first.pending.includes("tron"));
    assert.ok(!first.tokens.some((t) => t.network === "tron"));
    assert.equal(first.tokens.find((t) => t.key === "ethereum:eth1")?.balance, "1.5");

    tronCatalogSlow = false;
    releaseHeld();
    const second = await pollUntil((p) => !p.pending.includes("tron"));
    assert.equal(second.tokens.find((t) => t.key === "tron:usdt2")?.balance, "7");
  } finally {
    tronCatalogSlow = false;
    releaseHeld();
    setPartialWaitMs();
  }
});

test("slow rates answer with the last known prices and ratesPending, then catch up", async () => {
  await portfolio();
  expireRatesCache();
  ratesSlow = true;
  setPartialWaitMs(300);
  try {
    const first = await portfolio();
    assert.equal(first.ratesPending, true);
    assert.equal(first.tokens.find((t) => t.key === "ethereum:eth1")?.usdPrice, 2000);
    assert.ok(held.length >= 1);

    const again = await portfolio();
    assert.equal(again.ratesPending, true);
    assert.equal(held.length, 1, "concurrent pollers share one rates request");

    ratesSlow = false;
    releaseHeld();
    const caught = await pollUntil((p) => !p.ratesPending);
    assert.equal(caught.totalUsd, first.totalUsd);
  } finally {
    ratesSlow = false;
    releaseHeld();
    setPartialWaitMs();
  }
});

test("TRC-20 balances of an address TronGrid does not know come from balanceOf", async () => {
  // Two TronGrid calls behind the keyless gate, which earlier tests may still hold;
  // a Tron read they left in flight must finish before the mock changes.
  setPartialWaitMs(10_000);
  await portfolio();
  tronActivated = false;
  clearBalanceCache();
  try {
    const byKey = new Map((await portfolio()).tokens.map((t) => [t.key, t]));
    assert.equal(byKey.get("tron:trx1")?.balance, "0");
    assert.equal(byKey.get("tron:usdt2")?.balance, "6");
    assert.deepEqual(tronConstantCalls, [USDT_TRON]);
  } finally {
    tronActivated = true;
    setPartialWaitMs();
    clearBalanceCache();
  }
});

test("refresh reads the chain again past the cache but joins a read still in flight", async () => {
  ltcSlow = true;
  ltcRequests = 0;
  clearBalanceCache();
  setPartialWaitMs(300);
  try {
    assert.ok((await portfolio()).pending.includes("litecoin"));
    assert.ok((await portfolio(true)).pending.includes("litecoin"));
    assert.equal(ltcRequests, 1);

    releaseLtc();
    assert.ok(!(await portfolio()).pending.includes("litecoin"));
    await portfolio();
    assert.equal(ltcRequests, 1);

    const refreshed = await portfolio(true);
    assert.ok(refreshed.pending.includes("litecoin"));
    assert.equal(ltcRequests, 2);
    releaseLtc();
    const after = await portfolio();
    assert.equal(after.tokens.find((t) => t.key === "litecoin:native")?.balance, "1.5");
    assert.equal(ltcRequests, 2);
  } finally {
    ltcSlow = false;
    releaseLtc();
    setPartialWaitMs();
    clearBalanceCache();
  }
});

test("the token list shows hidden catalog entries and filters by network and text", async () => {
  const r = await send("GET", `/wallets/${walletId}/tokens?network=ethereum`);
  const list = (await r.json()) as TokensResponse;
  assert.deepEqual(
    list.tokens.map((t) => [t.symbol, t.visible]),
    [["ETH", true], ["USDT", true], ["WETH", false]],
  );
  assert.equal(list.total, 3);

  const q = (await (await send("GET", `/wallets/${walletId}/tokens?q=wrapped`)).json()) as TokensResponse;
  assert.deepEqual(q.tokens.map((t) => t.key), ["ethereum:weth1"]);

  const two = (await (await send("GET", `/wallets/${walletId}/tokens?network=tron,ethereum`)).json()) as TokensResponse;
  assert.deepEqual([...new Set(two.tokens.map((t) => t.network))], ["ethereum", "tron"]);

  assert.equal((await send("GET", `/wallets/${walletId}/tokens?network=moon`)).status, 400);
  assert.equal((await send("GET", `/wallets/${walletId}/tokens?network=ethereum,moon`)).status, 400);
});

test("visibility is per wallet, stored as deviations only and refused cross-origin", async () => {
  const foreign = await fetch(`${base}/api/wallets/${walletId}/tokens/ethereum/weth1`, {
    method: "PUT",
    headers: { "content-type": "application/json", origin: "http://evil.example" },
    body: JSON.stringify({ visible: true }),
  });
  assert.equal(foreign.status, 403);

  const show = await send("PUT", `/wallets/${walletId}/tokens/ethereum/weth1`, { visible: true });
  assert.deepEqual(await show.json(), { key: "ethereum:weth1", visible: true });
  const hide = await send("PUT", `/wallets/${walletId}/tokens/ethereum/usdt1`, { visible: false });
  assert.equal(hide.status, 200);

  clearBalanceCache();
  const keys = (await portfolio()).tokens.map((t) => t.key);
  assert.ok(keys.includes("ethereum:weth1"));
  assert.ok(!keys.includes("ethereum:usdt1"));

  const prefs = JSON.parse(readFileSync(join(dir, "manager-prefs.json"), "utf8"));
  assert.deepEqual(prefs.tokenVisibility, { [walletId]: { "ethereum:weth1": true, "ethereum:usdt1": false } });

  await send("PUT", `/wallets/${walletId}/tokens/ethereum/usdt1`, { visible: true });
  const after = JSON.parse(readFileSync(join(dir, "manager-prefs.json"), "utf8"));
  assert.deepEqual(after.tokenVisibility, { [walletId]: { "ethereum:weth1": true } });

  assert.equal((await send("PUT", `/wallets/${walletId}/tokens/ethereum/nope`, { visible: true })).status, 404);
  assert.equal((await send("PUT", `/wallets/${walletId}/tokens/ethereum/weth1`, { visible: "yes" })).status, 400);
});

test("icons come only from the catalog, only as images, and are cached on disk", async () => {
  const ok = await fetch(`${base}/icons/ethereum/eth1`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  assert.ok(Buffer.from(await ok.arrayBuffer()).equals(PNG));
  assert.ok(existsSync(join(dir, "icon-cache", "ethereum", "eth1.img")));

  assert.equal((await fetch(`${base}/icons/ethereum/usdt1`)).status, 404);
  assert.equal((await fetch(`${base}/icons/ethereum/weth1`)).status, 404);
  assert.equal((await fetch(`${base}/icons/moon/eth1`)).status, 404);
  assert.equal((await fetch(`${base}/icons/ethereum/..%2F..%2Fkeystore`)).status, 404);
});

test("sort preferences are validated and stored", async () => {
  const r = await send("PATCH", "/prefs", { tokenSort: "name", showZeroBalances: false });
  const prefs = (await r.json()) as { tokenSort: string; showZeroBalances: boolean };
  assert.equal(prefs.tokenSort, "name");
  assert.equal(prefs.showZeroBalances, false);
  assert.equal((await send("PATCH", "/prefs", { tokenSort: "random" })).status, 400);
  assert.equal((await send("PATCH", "/prefs", { showZeroBalances: 1 })).status, 400);
});

test("deleting a wallet forgets its token visibility", async () => {
  const r = await send("DELETE", `/wallets/${walletId}`, { acknowledged: true });
  assert.equal(r.status, 200);
  const prefs = JSON.parse(readFileSync(join(dir, "manager-prefs.json"), "utf8"));
  assert.deepEqual(prefs.tokenVisibility, {});
  assert.equal((await send("GET", `/wallets/${walletId}/portfolio`)).status, 404);
});
