/**
 * Keyless TronGrid gate for direct balance reads (get_balance, send amount
 * check): constant calls go out one at a time behind the shared gate, TRC-20
 * decimals/symbol are read once per contract, and a gated 429 is not retried
 * inside the suspension window.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const OWNER = "TRPMr1VDjEfEdLRLZ2ioForHrvoSunYALp";
const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const word = (n: bigint) => n.toString(16).padStart(64, "0");
const abiString = (s: string) =>
  word(32n) + word(BigInt(s.length)) + Buffer.from(s, "utf8").toString("hex").padEnd(64, "0");

const calls: Array<{ selector: string; start: number; end: number }> = [];
let rateLimitedHits = 0;
let mock: Server;

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function startMock(): Promise<string> {
  mock = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://mock").pathname;
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (path === "/tron/wallet/triggerconstantcontract") {
      const { function_selector: selector } = JSON.parse(await body(req)) as { function_selector: string };
      const start = Date.now();
      await new Promise((r) => setTimeout(r, 50));
      calls.push({ selector, start, end: Date.now() });
      const result =
        selector === "balanceOf(address)" ? word(6_000_000n) : selector === "decimals()" ? word(6n) : abiString("USDT");
      return json(200, { constant_result: [result] });
    }
    if (path === "/limited") {
      rateLimitedHits++;
      return json(429, { Error: "suspended" });
    }
    json(404, {});
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
}

const mockBase = await startMock();
const dir = mkdtempSync(join(tmpdir(), "iw-keyless-"));
process.env.IW_KEYSTORE_DIR = dir;
process.env.IW_LOG_FILE = "";
process.env.IW_TRON_API = `${mockBase}/tron`;

const { getBalance } = await import("./balances.js");
const { httpJson } = await import("./http.js");
const { getConfig } = await import("../config.js");

// The first getConfig() reads keystore secrets and the OS fingerprint; inside
// the first gate slot it would delay that call and skew the measured spacing.
getConfig();

after(() => {
  mock.close();
  rmSync(dir, { recursive: true, force: true });
});

test("a TRC-20 balance reads one constant call at a time and its metadata once", async () => {
  const first = await getBalance("tron", OWNER, USDT);
  assert.equal(first.raw, "6000000");
  assert.equal(first.symbol, "USDT");
  assert.equal(first.decimals, 6);
  assert.deepEqual(
    calls.map((c) => c.selector),
    ["balanceOf(address)", "decimals()", "symbol()"],
  );
  for (let i = 1; i < calls.length; i++) {
    assert.ok(calls[i].start >= calls[i - 1].end, "constant calls must not overlap");
    // The gate spaces sends by 1.1 s; arrival at the mock jitters under load.
    assert.ok(calls[i].start - calls[i - 1].start >= 900, "constant calls must be spaced by the gate");
  }

  const second = await getBalance("tron", OWNER, USDT);
  assert.equal(second.formatted, "6.0");
  assert.deepEqual(
    calls.slice(3).map((c) => c.selector),
    ["balanceOf(address)"],
  );
});

test("retry429: false leaves a 429 to the caller instead of retrying into the suspension", async () => {
  await assert.rejects(
    httpJson(`${mockBase}/limited`, { method: "GET" }, { retries: 2, retry429: false }),
    (e: Error & { status?: number }) => e.status === 429,
  );
  assert.equal(rateLimitedHits, 1);

  await assert.rejects(httpJson(`${mockBase}/limited`, { method: "GET" }, { retries: 1 }));
  assert.equal(rateLimitedHits, 3);
});
