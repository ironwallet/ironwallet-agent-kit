/**
 * History page of the manager API. TronGrid and the catalog are a local mock;
 * Bitcoin's indexer is down; Litecoin's Esplora is down and BlockCypher answers.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import bs58check from "bs58check";
import type { HistoryResponse, WalletResponse } from "./contract.js";

const USDT_TRON = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const STRANGER = "TJyVb2esHZLs2aHG4cYt2GGyPb3G2cFgkf";

const CATALOG = {
  assets: [
    { asset_id: "trx1", symbol: "TRX", name: "TRX (Tron)", decimals: 6, default: true, logoUri: "assets/trx1/logo.png" },
    { asset_id: "usdt2", address: USDT_TRON, symbol: "usdt", name: "Tether USD", decimals: 6, default: true, type: "TRC20" },
  ],
};

const toHex = (address: string) => Buffer.from(bs58check.decode(address)).toString("hex");

let mock: Server;
let main = { id: "", tron: "", litecoin: "" };
let savings = { id: "", tron: "", litecoin: "" };
const dir = mkdtempSync(join(tmpdir(), "iw-manager-history-"));

async function startMock(): Promise<string> {
  mock = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (url.pathname === "/static/assets/main/blockchains/tron/assets.mainnet.json") return json(200, CATALOG);
    if (url.pathname === `/tron/v1/accounts/${main.tron}/transactions`) {
      return json(200, {
        success: true,
        data: [
          {
            txID: "aa".repeat(32),
            blockNumber: 70_000_000,
            block_timestamp: Date.parse("2026-09-17T08:45:26Z"),
            ret: [{ contractRet: "SUCCESS", fee: 0 }],
            raw_data: {
              contract: [
                {
                  type: "TransferContract",
                  parameter: { value: { amount: 120_000_000, owner_address: toHex(savings.tron), to_address: toHex(main.tron) } },
                },
              ],
            },
          },
        ],
      });
    }
    if (url.pathname === `/tron/v1/accounts/${main.tron}/transactions/trc20`) {
      return json(200, {
        success: true,
        data: [
          {
            transaction_id: "bb".repeat(32),
            block_timestamp: Date.parse("2026-09-18T10:00:00Z"),
            from: main.tron,
            to: STRANGER,
            type: "Transfer",
            value: "9700000",
            token_info: { symbol: "USDT", address: USDT_TRON, decimals: 6 },
          },
          {
            transaction_id: "dd".repeat(32),
            block_timestamp: Date.parse("2026-09-18T09:00:00Z"),
            from: main.tron,
            to: STRANGER,
            type: "Transfer",
            value: "0",
            token_info: { symbol: "USDT", address: USDT_TRON, decimals: 6 },
          },
        ],
      });
    }
    if (url.pathname === `/blockcypher/v1/ltc/main/addrs/${main.litecoin}/full`) {
      return json(200, {
        hasMore: false,
        txs: [
          {
            hash: "cc".repeat(32),
            block_height: 3_195_900,
            confirmed: "2026-10-16T09:30:00Z",
            fees: 2_260,
            inputs: [{ addresses: [savings.litecoin], output_value: 150_002_260 }],
            outputs: [{ addresses: [main.litecoin], value: 150_000_000 }],
          },
        ],
      });
    }
    json(503, { error: "down" });
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
process.env.IW_TRON_API = `${mockBase}/tron`;
process.env.IW_BTC_API = `${mockBase}/down`;
process.env.IW_LTC_API = `${mockBase}/down`;
process.env.IW_HISTORY_APIS = JSON.stringify({
  tron: [{ kind: "trongrid" }],
  bitcoin: [{ kind: "esplora" }],
  litecoin: [{ kind: "esplora" }, { kind: "blockcypher", url: `${mockBase}/blockcypher/v1/ltc/main` }],
});

const { ensureManager, closeManager } = await import("./manager.js");

let base = "";

function send(method: string, sub: string, payload?: unknown) {
  return fetch(`${base}/api${sub}`, {
    method,
    headers: payload === undefined ? undefined : { "content-type": "application/json", origin: new URL(base).origin },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

async function create(name: string) {
  const { wallet } = (await (await send("POST", "/wallets", { name })).json()) as WalletResponse;
  return { id: wallet.id, tron: wallet.addresses.tron, litecoin: wallet.addresses.litecoin };
}

before(async () => {
  base = await ensureManager();
  await send("POST", "/consent", { understood: true });
  main = await create("Main");
  savings = await create("Savings");
});

after(() => {
  closeManager();
  mock.close();
  rmSync(dir, { recursive: true, force: true });
});

test("a page joins explorer rows with the catalog, own wallet names and explorer links", async () => {
  const r = await send("GET", `/wallets/${main.id}/history?network=tron`);
  assert.equal(r.status, 200);
  const page = (await r.json()) as HistoryResponse;
  assert.equal(page.status, "ok");
  assert.equal(page.address, main.tron);
  assert.equal(page.nextCursor, null);

  assert.equal(page.items.length, 2, "the zero-amount USDT transfer is hidden");
  const [sent, received] = page.items;
  assert.equal(sent.hash, "bb".repeat(32));
  assert.equal(sent.direction, "out");
  assert.equal(sent.amount, "9.7");
  assert.deepEqual(
    [sent.asset.symbol, sent.asset.name, sent.asset.standard, sent.asset.assetId, sent.asset.icon],
    ["USDT", "Tether USD", "TRC20", "usdt2", null],
  );
  assert.equal(sent.counterpartyWallet, null);
  assert.equal(sent.explorerUrl, `https://tronscanner.org/transactions/${"bb".repeat(32)}`);

  assert.equal(received.direction, "in");
  assert.equal(received.amount, "120");
  assert.equal(received.from, savings.tron);
  assert.equal(received.counterpartyWallet, "Savings");
  assert.equal(received.asset.icon, "icons/tron/trx1");
  assert.match(received.id, /^[0-9a-f]{16}$/);
  assert.notEqual(received.id, sent.id);
  assert.equal(JSON.stringify(page).includes(mockBase), false);
});

test("an explorer outage is reported as unavailable, not as an empty history", async () => {
  const page = (await (await send("GET", `/wallets/${main.id}/history?network=bitcoin`)).json()) as HistoryResponse;
  assert.equal(page.status, "unavailable");
  assert.deepEqual(page.items, []);
});

test("Litecoin history comes from BlockCypher when the Esplora host is down", async () => {
  const page = (await (await send("GET", `/wallets/${main.id}/history?network=litecoin`)).json()) as HistoryResponse;
  assert.equal(page.status, "ok");
  const [received] = page.items;
  assert.equal(received?.hash, "cc".repeat(32));
  assert.equal(received?.direction, "in");
  assert.equal(received?.amount, "1.5");
  assert.equal(received?.asset.symbol, "LTC");
  assert.equal(received?.counterpartyWallet, "Savings");
});

test("bad input is refused", async () => {
  assert.equal((await send("GET", `/wallets/${main.id}/history`)).status, 400);
  assert.equal((await send("GET", `/wallets/${main.id}/history?network=moon`)).status, 400);
  assert.equal((await send("GET", `/wallets/${main.id}/history?network=tron&cursor=garbage`)).status, 400);
  assert.equal((await send("GET", `/wallets/0000000000000000/history?network=tron`)).status, 404);
});
