/**
 * HTTP-level tests for the manager's non-API routes: the capability URL, the
 * deposit QR PNG behind get_deposit_qr's `qr_url`, and the absence of the old
 * form endpoints. Runs the real server on 127.0.0.1 against a throwaway
 * keystore directory.
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
const { createWallets, walletNames } = await import("../keystore/store.js");
const { depositQrUrl } = await import("../qr/deposit-qr.js");
const PASS = process.env.IW_PASSPHRASE;

let base = ""; // http://127.0.0.1:port/<token>

before(async () => {
  base = await ensureManager();
});

after(() => {
  closeManager();
  rmSync(dir, { recursive: true, force: true });
});

test("manager URL is a 32-hex capability under 127.0.0.1", async () => {
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}$/);
  assert.equal(await ensureManager(), base);
});

test("paths outside the capability are not found", async () => {
  const { origin } = new URL(base);
  assert.equal((await fetch(`${origin}/`)).status, 404);
  assert.equal((await fetch(`${origin}/${"0".repeat(32)}/`)).status, 404);
});

test("the deposit QR renders for an owned address and refuses others", async () => {
  const [wallet] = createWallets(1, PASS);
  const ok = await fetch(depositQrUrl(base, "ethereum", wallet.addresses.ethereum));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  const captioned = await ok.arrayBuffer();
  assert.ok(captioned.byteLength > 1000);

  const plain = await fetch(`${depositQrUrl(base, "ethereum", wallet.addresses.ethereum)}&plain=1`);
  assert.equal(plain.status, 200);
  const png = Buffer.from(await plain.arrayBuffer());
  assert.equal(png.readUInt32BE(16), png.readUInt32BE(20), "square, no caption band");

  const foreign = await fetch(depositQrUrl(base, "ethereum", "0x000000000000000000000000000000000000dEaD"));
  assert.equal(foreign.status, 404);
});

test("the old form endpoints are gone", async () => {
  assert.deepEqual(walletNames(), ["wallet-1"]);
  for (const sub of ["/delete", "/delete/confirm", "/create", "/import", "/backup", "/consent"]) {
    const r = await fetch(`${base}${sub}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=wallet-1&confirm=wallet-1&lose_seed=1&understood=1",
    });
    assert.equal(r.status, 405, sub);
  }
  for (const sub of ["/legacy", "/consent", "/assets/wordmark.svg"]) {
    assert.equal((await fetch(`${base}${sub}`)).status, 404, sub);
  }
  assert.deepEqual(walletNames(), ["wallet-1"]);
});
