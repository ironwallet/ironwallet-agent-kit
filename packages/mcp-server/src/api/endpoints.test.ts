/**
 * Fallback endpoints: a host that is down, rate-limited or on the wrong chain
 * hands the read to the next one; a request error from the primary is final;
 * a fallback that serves only part of the API does not stop the chain.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

/** ethers answers a repeat of the same request within 250 ms from cache, so each read uses its own owner. */
const owner = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const TWO_ETH = "0x1bc16d674ec80000";

const balanceHits = new Map<string, number>();
let bscPrimaryDown = false;
let mock: Server;

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

type RpcCall = { id: number; method: string };

function evmAnswer(name: string, call: RpcCall): unknown {
  if (call.method === "eth_chainId") return { jsonrpc: "2.0", id: call.id, result: name === "wrong" ? "0x38" : "0x1" };
  if (call.method === "eth_getBalance") {
    balanceHits.set(name, (balanceHits.get(name) ?? 0) + 1);
    return { jsonrpc: "2.0", id: call.id, result: TWO_ETH };
  }
  return { jsonrpc: "2.0", id: call.id, error: { code: -32601, message: "method not found" } };
}

async function startMock(): Promise<string> {
  mock = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://mock").pathname;
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    const evm = /^\/evm\/([\w-]+)$/.exec(path);
    if (evm) {
      const name = evm[1]!;
      if (name === "e503" || (name === "bsc-primary" && bscPrimaryDown)) return json(503, { error: "down" });
      const payload = JSON.parse(await body(req)) as RpcCall | RpcCall[];
      return json(200, Array.isArray(payload) ? payload.map((c) => evmAnswer(name, c)) : evmAnswer(name, payload));
    }
    if (path === "/sol/bad") {
      return json(200, { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Invalid param" } });
    }
    if (path === "/sol/ok") {
      balanceHits.set("sol-ok", (balanceHits.get("sol-ok") ?? 0) + 1);
      return json(200, { jsonrpc: "2.0", id: 1, result: { value: 5 } });
    }
    if (path.startsWith("/esplora/ok/address/")) {
      return json(200, { chain_stats: { funded_txo_sum: 1500, spent_txo_sum: 500 }, mempool_stats: {} });
    }
    if (/^\/blockcypher\/v1\/btc\/main\/addrs\/[^/]+\/balance$/.test(path)) {
      return json(200, { balance: 3000, unconfirmed_balance: 700, final_balance: 3700 });
    }
    json(404, { error: "not here" });
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
}

async function closedPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return port;
}

const mockBase = await startMock();
const dead = `http://127.0.0.1:${await closedPort()}`;
const dir = mkdtempSync(join(tmpdir(), "iw-endpoints-"));

process.env.IW_KEYSTORE_DIR = dir;
process.env.IW_LOG_FILE = "";
process.env.IW_HTTP_RETRIES = "0";
process.env.IW_RPC_ETHEREUM = `${dead}/rpc`;
process.env.IW_RPC_FALLBACK_ETHEREUM = `${mockBase}/evm/e503, ${mockBase}/evm/ok`;
process.env.IW_RPC_BSC = `${mockBase}/evm/bsc-primary`;
process.env.IW_RPC_FALLBACK_BSC = `${mockBase}/evm/wrong`;
process.env.IW_SOLANA_RPC = `${mockBase}/sol/bad`;
process.env.IW_RPC_FALLBACK_SOLANA = `${mockBase}/sol/ok`;
process.env.IW_LTC_API = `${dead}/ltc`;
process.env.IW_RPC_FALLBACK_LITECOIN = `${mockBase}/esplora/missing, ${mockBase}/esplora/ok`;
process.env.IW_BTC_API = `${dead}/btc`;
process.env.IW_RPC_FALLBACK_BITCOIN = `${mockBase}/blockcypher/v1/btc/main`;

const { getBalance } = await import("./balances.js");
const { endpointsFor } = await import("./endpoints.js");
const stdout: string[] = [];
const consoleLog = console.log;
console.log = (...args: unknown[]) => void stdout.push(args.map(String).join(" "));

after(() => {
  console.log = consoleLog;
  mock.close();
  rmSync(dir, { recursive: true, force: true });
});

test("an unreachable and a failing host hand an EVM read to the next one, which then goes first", async () => {
  const bal = await getBalance("ethereum", owner(1));
  assert.equal(bal.raw, "2000000000000000000");
  assert.equal(balanceHits.get("ok"), 1);
  assert.deepEqual(endpointsFor("ethereum"), [`${mockBase}/evm/ok`, `${dead}/rpc`, `${mockBase}/evm/e503`]);

  await getBalance("ethereum", owner(2));
  assert.equal(balanceHits.get("ok"), 2);
  assert.deepEqual(stdout, [], "ethers must not log to stdout (the MCP channel)");
});

test("a fallback on another chain is skipped and the primary's error surfaces", async () => {
  await getBalance("bsc", owner(3));
  bscPrimaryDown = true;
  await assert.rejects(getBalance("bsc", owner(4)), (e: Error & { code?: string }) => e.code === "SERVER_ERROR");
  assert.equal(balanceHits.get("wrong"), undefined);
});

test("a request error from the primary is final", async () => {
  await assert.rejects(getBalance("solana", "11111111111111111111111111111111"), /Invalid param/);
  assert.equal(balanceHits.get("sol-ok"), undefined);
});

test("a fallback that lacks a route does not stop the chain", async () => {
  const bal = await getBalance("litecoin", "ltc1qtest");
  assert.equal(bal.raw, "1000");
});

test("a BlockCypher fallback behind an Esplora primary is read in its own format", async () => {
  const bal = await getBalance("bitcoin", "bc1qtest");
  assert.equal(bal.raw, "3700");
  assert.equal(bal.formatted, "0.000037");
});
