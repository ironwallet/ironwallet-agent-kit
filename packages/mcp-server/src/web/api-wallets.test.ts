/**
 * Wallet endpoints of the manager JSON API: list, create, import, rename,
 * backup, delete and the selected-wallet preference. Runs the real server against a
 * throwaway keystore; recovery phrases are generated at run time.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { WalletResponse, WalletsResponse } from "./contract.js";

const dir = mkdtempSync(join(tmpdir(), "iw-manager-wallets-"));
process.env.IW_KEYSTORE_DIR = dir;
process.env.IW_PASSPHRASE = "test-passphrase-not-secret";
process.env.IW_LOG_FILE = "";

const { ensureManager, closeManager } = await import("./manager.js");
const { loadKeystore, walletNames } = await import("../keystore/store.js");
const { newMnemonic } = await import("../wallet/derive.js");

let base = "";
let origin = "";

before(async () => {
  base = await ensureManager();
  origin = new URL(base).origin;
});

after(() => {
  closeManager();
  rmSync(dir, { recursive: true, force: true });
});

function send(method: string, sub: string, body?: unknown) {
  return fetch(`${base}/api${sub}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json", origin },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function list(): Promise<WalletsResponse> {
  return (await (await send("GET", "/wallets")).json()) as WalletsResponse;
}

async function errorOf(r: Response): Promise<{ status: number; code: string; message: string }> {
  const body = (await r.json()) as { error: { code: string; message: string } };
  return { status: r.status, ...body.error };
}

test("an empty keystore lists no wallets and no selection", async () => {
  assert.deepEqual(await list(), { wallets: [], selectedId: null });
});

test("mutations wait for the disclaimer", async () => {
  const r = await send("POST", "/wallets", { name: "Main" });
  assert.equal((await errorOf(r)).code, "consent_required");
  assert.equal(r.status, 403);
  assert.deepEqual(walletNames(), []);

  const ok = await send("POST", "/consent", { understood: true });
  assert.equal(ok.status, 200);
});

test("create keeps the exact name, selects the wallet and hides the seed", async () => {
  const r = await send("POST", "/wallets", { name: "  Wallet   #1 " });
  assert.equal(r.status, 200);
  const { wallet } = (await r.json()) as WalletResponse;
  assert.equal(wallet.name, "Wallet #1");
  assert.equal(wallet.backedUp, false);
  assert.match(wallet.id, /^[0-9a-f]{16}$/);
  assert.match(wallet.addresses.ethereum, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(JSON.stringify(wallet).includes("encSeed"), false);
  assert.equal("mnemonic" in wallet, false);

  const listed = await list();
  assert.deepEqual(listed.wallets.map((w) => w.name), ["Wallet #1"]);
  assert.equal(listed.selectedId, wallet.id);
});

test("names must be unique regardless of case and not blank or too long", async () => {
  for (const [name, pattern] of [
    ["wallet #1", /already exists/],
    ["   ", /Enter a wallet name/],
    ["x".repeat(41), /at most 40/],
    ["bad\nname", /invalid characters/],
  ] as const) {
    const e = await errorOf(await send("POST", "/wallets", { name }));
    assert.equal(e.status, 400, name);
    assert.match(e.message, pattern);
  }
  const e = await errorOf(await send("POST", "/wallets", { name: 42 }));
  assert.equal(e.status, 400);
  assert.equal(walletNames().length, 1);
});

test("import stores the phrase under the given name, once", async () => {
  const phrase = newMnemonic(12);
  const r = await send("POST", "/wallets/import", { name: "Imported", mnemonic: `  ${phrase.toUpperCase()}  ` });
  assert.equal(r.status, 200);
  const { wallet } = (await r.json()) as WalletResponse;
  assert.equal(wallet.name, "Imported");
  assert.equal(wallet.backedUp, true);
  assert.equal((await list()).selectedId, wallet.id);

  const again = await errorOf(await send("POST", "/wallets/import", { name: "Other", mnemonic: phrase }));
  assert.equal(again.status, 400);
  assert.match(again.message, /already imported as "Imported"/);
});

test("an invalid phrase is refused without echoing it", async () => {
  const words = newMnemonic(12).split(" ");
  const broken = [...words.slice(0, 11), "qqqq"].join(" ");
  const e = await errorOf(await send("POST", "/wallets/import", { name: "Broken", mnemonic: broken }));
  assert.equal(e.status, 400);
  assert.equal(e.message, "This is not a valid recovery phrase. Check the words and their order.");
  assert.deepEqual(walletNames(), ["Wallet #1", "Imported"]);
});

test("rename keeps the id; a taken name is refused", async () => {
  const [first, second] = (await list()).wallets;
  const r = await send("PATCH", `/wallets/${first.id}`, { name: "Main" });
  assert.equal(r.status, 200);
  const { wallet } = (await r.json()) as WalletResponse;
  assert.equal(wallet.id, first.id);
  assert.equal(wallet.name, "Main");

  const taken = await errorOf(await send("PATCH", `/wallets/${second.id}`, { name: "MAIN" }));
  assert.equal(taken.status, 400);
  assert.deepEqual(walletNames(), ["Main", "Imported"]);
});

test("the phrase is shown only on a same-origin POST and does not count as a backup", async () => {
  const [main] = (await list()).wallets;
  assert.equal((await send("GET", `/wallets/${main.id}/mnemonic`)).status, 404);
  const foreign = await fetch(`${base}/api/wallets/${main.id}/mnemonic`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://evil.example" },
    body: "{}",
  });
  assert.equal(foreign.status, 403);

  const r = await send("POST", `/wallets/${main.id}/mnemonic`, {});
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control") ?? "", /no-store/);
  const { words } = (await r.json()) as { words: string[] };
  assert.equal(words.length, 12);
  assert.equal((await list()).wallets[0].backedUp, false);
});

test("backup verification needs the exact order and then marks the wallet", async () => {
  const [main] = (await list()).wallets;
  const { words } = (await (await send("POST", `/wallets/${main.id}/mnemonic`, {})).json()) as {
    words: string[];
  };
  const swapped = [words[1], words[0], ...words.slice(2)];
  const wrong = await errorOf(await send("POST", `/wallets/${main.id}/backup/verify`, { words: swapped }));
  assert.equal(wrong.status, 400);
  assert.equal(wrong.code, "backup_mismatch");
  for (const w of words) assert.equal(wrong.message.split(/\W+/).includes(w), false);
  assert.equal((await list()).wallets[0].backedUp, false);

  const short = await errorOf(await send("POST", `/wallets/${main.id}/backup/verify`, { words: words.slice(0, 11) }));
  assert.equal(short.code, "backup_mismatch");
  const junk = await errorOf(await send("POST", `/wallets/${main.id}/backup/verify`, { words: "a b c" }));
  assert.equal(junk.status, 400);

  const ok = await send("POST", `/wallets/${main.id}/backup/verify`, { words });
  assert.equal(ok.status, 200);
  const { wallet } = (await ok.json()) as WalletResponse;
  assert.equal(wallet.backedUp, true);
  assert.equal((await list()).wallets[0].backedUp, true);
});

test("selection is stored and only accepts existing wallets", async () => {
  const [first] = (await list()).wallets;
  const r = await send("PATCH", "/prefs", { selectedWalletId: first.id });
  assert.deepEqual(await r.json(), {
    selectedWalletId: first.id,
    tokenSort: "value",
    showZeroBalances: true,
    theme: null,
  });
  assert.equal((await list()).selectedId, first.id);

  const missing = await send("PATCH", "/prefs", { selectedWalletId: "0".repeat(16) });
  assert.equal(missing.status, 404);
});

test("a saved theme is validated and lands on <html> before the app runs", async () => {
  assert.equal((await send("PATCH", "/prefs", { theme: "sepia" })).status, 400);
  const r = await send("PATCH", "/prefs", { theme: "dark" });
  assert.equal(((await r.json()) as { theme: string }).theme, "dark");

  const page = await fetch(`${base}/`);
  if (page.status === 503) return; // UI not built
  assert.match(await page.text(), /<html data-theme="dark"/);
});

test("delete needs the acknowledgement; the selection falls back to the next wallet", async () => {
  const [first, second] = (await list()).wallets;
  const bare = await send("DELETE", `/wallets/${first.id}`, {});
  assert.equal(bare.status, 400);
  assert.equal(walletNames().length, 2);

  const ok = await send("DELETE", `/wallets/${first.id}`, { acknowledged: true });
  assert.deepEqual(await ok.json(), { deleted: true });
  assert.deepEqual(walletNames(), ["Imported"]);
  assert.equal((await list()).selectedId, second.id);

  const gone = await send("DELETE", `/wallets/${first.id}`, { acknowledged: true });
  assert.equal(gone.status, 404);
  assert.equal(loadKeystore().wallets.length, 1);
});
