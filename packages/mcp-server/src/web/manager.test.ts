/**
 * HTTP-level tests for the local wallet manager: consent redirect and the
 * two-step wallet deletion. Runs the real server on 127.0.0.1 against a
 * throwaway keystore directory.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "iw-manager-"));
process.env.IW_KEYSTORE_DIR = dir;
process.env.IW_PASSPHRASE = "test-passphrase-not-secret";
process.env.IW_LOG_FILE = "";

const { ensureManager, closeManager } = await import("./manager.js");
const { createWallets, loadKeystore, markBackedUp, walletNames } = await import("../keystore/store.js");
const PASS = process.env.IW_PASSPHRASE;

let base = ""; // http://127.0.0.1:port/<token>
let path = ""; // /<token>

before(async () => {
  base = await ensureManager();
  path = new URL(base).pathname;
});

after(() => {
  closeManager();
  rmSync(dir, { recursive: true, force: true });
});

function post(sub: string, form: Record<string, string>) {
  return fetch(base + sub, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    redirect: "manual",
  });
}

const get = (sub: string) => fetch(base + sub, { redirect: "manual" });

test("manager URL is a 32-hex capability under 127.0.0.1", () => {
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}$/);
});

test("before consent the dashboard shows the disclaimer and delete is refused", async () => {
  const r = await get("/");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /\/consent/);

  createWallets(1, PASS);
  const d = await post("/delete", { name: "wallet-1" });
  assert.equal(d.status, 403);
  assert.deepEqual(walletNames(), ["wallet-1"]);
});

test("Continue on the disclaimer redirects to the dashboard; GET /consent redirects too", async () => {
  const r = await post("/consent", { understood: "1" });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), `${path}/`);

  const stale = await get("/consent");
  assert.equal(stale.status, 303);
  assert.equal(stale.headers.get("location"), `${path}/`);

  const dash = await get("/");
  assert.equal(dash.status, 200);
  const body = await dash.text();
  assert.match(body, /wallet-1/);
  assert.match(body, new RegExp(`action="${path}/delete"`));
});

test("Delete button opens a confirmation page; never-backed-up wallet needs the seed acknowledgement", async () => {
  const r = await post("/delete", { name: "wallet-1" });
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.match(body, /Delete "wallet-1"\?/);
  assert.match(body, /name="lose_seed"/);
  assert.match(body, /Type the wallet name to confirm/);
  assert.deepEqual(walletNames(), ["wallet-1"], "the first step must not delete");
});

test("confirm rejects a wrong name and a missing seed acknowledgement", async () => {
  const wrong = await post("/delete/confirm", { name: "wallet-1", confirm: "wallet-2", lose_seed: "1" });
  assert.equal(wrong.status, 400);
  assert.match(await wrong.text(), /does not match/);

  const noAck = await post("/delete/confirm", { name: "wallet-1", confirm: "wallet-1" });
  assert.equal(noAck.status, 400);
  assert.match(await noAck.text(), /recovery phrase will be destroyed/);

  assert.deepEqual(walletNames(), ["wallet-1"]);
});

test("confirm with the typed name and acknowledgement deletes and redirects with a notice", async () => {
  const r = await post("/delete/confirm", { name: "wallet-1", confirm: "wallet-1", lose_seed: "1" });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), `${path}/?deleted=wallet-1`);
  assert.deepEqual(walletNames(), []);

  const dash = await get("/?deleted=wallet-1");
  assert.equal(dash.status, 200);
  const body = await dash.text();
  assert.match(body, /Deleted &quot;wallet-1&quot;\./);
  assert.match(body, /No wallets yet/);
});

test("a backed-up wallet is deleted with the typed name alone", async () => {
  createWallets(2, PASS);
  markBackedUp("wallet-1");
  assert.deepEqual(walletNames(), ["wallet-1", "wallet-2"]);

  const page = await post("/delete", { name: "wallet-1" });
  assert.equal(page.status, 200);
  assert.doesNotMatch(await page.text(), /name="lose_seed"/);

  const r = await post("/delete/confirm", { name: "wallet-1", confirm: " wallet-1 " });
  assert.equal(r.status, 303);
  assert.deepEqual(walletNames(), ["wallet-2"]);
  assert.equal(loadKeystore().wallets[0].backedUp, false, "the other wallet is untouched");
});

test("unknown wallet or stale GET on delete URLs just returns to the list", async () => {
  for (const r of [
    await post("/delete", { name: "ghost" }),
    await post("/delete/confirm", { name: "ghost", confirm: "ghost", lose_seed: "1" }),
    await get("/delete"),
    await get("/delete/confirm"),
  ]) {
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("location"), `${path}/`);
  }
  assert.deepEqual(walletNames(), ["wallet-2"]);
});

test("a wallet name cannot break out of the inline script on the confirmation page", async () => {
  createWallets(1, PASS, { namePrefix: '</script><img src=x onerror=alert(1)>' });
  const name = walletNames().find((n) => n.startsWith("</script>"))!;
  const r = await post("/delete", { name });
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.doesNotMatch(body, /<\/script><img/);
  assert.match(body, /\\u003c\/script\\u003e/);
});
