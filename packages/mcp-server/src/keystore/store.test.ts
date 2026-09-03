import assert from "node:assert/strict";
import { lstatSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// getConfig() caches on first call, so the env must be set before any import
// that touches it. Each test file runs in its own process.
const dir = mkdtempSync(join(tmpdir(), "iw-store-"));
process.env.IW_KEYSTORE_DIR = dir;
process.env.IW_PASSPHRASE = "test-passphrase-not-secret";
process.env.IW_LOG_FILE = "";

const { createWallets, loadKeystore, markBackedUp, removeWallet, walletNames } = await import("./store.js");
const PASS = process.env.IW_PASSPHRASE;

after(() => rmSync(dir, { recursive: true, force: true }));

test("removeWallet drops exactly the named wallet and keeps the rest", () => {
  createWallets(3, PASS);
  assert.deepEqual(walletNames(), ["wallet-1", "wallet-2", "wallet-3"]);
  const before = loadKeystore().wallets;

  removeWallet("wallet-2");

  const after = loadKeystore().wallets;
  assert.deepEqual(
    after.map((w) => w.name),
    ["wallet-1", "wallet-3"],
  );
  // Untouched entries are byte-identical (encrypted seed included).
  assert.deepEqual(after[0], before[0]);
  assert.deepEqual(after[1], before[2]);
});

test("removeWallet on an unknown name throws and changes nothing", () => {
  const before = readFileSync(join(dir, "keystore.json"), "utf8");
  assert.throws(() => removeWallet("nope"), /not found/);
  assert.equal(readFileSync(join(dir, "keystore.json"), "utf8"), before);
});

test("saves are atomic: no temp files are left behind and the file stays valid JSON", () => {
  markBackedUp("wallet-1");
  removeWallet("wallet-3");
  const files = readdirSync(dir);
  assert.ok(files.includes("keystore.json"));
  assert.equal(files.filter((f) => f.endsWith(".tmp")).length, 0, `temp files left: ${files}`);
  const ks = JSON.parse(readFileSync(join(dir, "keystore.json"), "utf8"));
  assert.equal(ks.version, 1);
  assert.deepEqual(
    ks.wallets.map((w: { name: string; backedUp: boolean }) => [w.name, w.backedUp]),
    [["wallet-1", true]],
  );
});

test("removing the last wallet leaves an empty keystore, not a missing file", () => {
  removeWallet("wallet-1");
  assert.deepEqual(loadKeystore(), { version: 1, wallets: [] });
});

test("a symlinked keystore.json is written through, not replaced by a regular file", (t) => {
  const link = join(dir, "keystore.json");
  const target = join(dir, "real-keystore.json");
  renameSync(link, target);
  try {
    symlinkSync(target, link, "file");
  } catch (e) {
    renameSync(target, link);
    // Windows needs Developer Mode or admin rights for file symlinks.
    t.skip(`symlinks not permitted here: ${(e as Error).message}`);
    return;
  }

  createWallets(1, PASS);

  assert.ok(lstatSync(link).isSymbolicLink(), "keystore.json must still be a symlink");
  assert.deepEqual(
    JSON.parse(readFileSync(target, "utf8")).wallets.map((w: { name: string }) => w.name),
    ["wallet-1"],
  );
  assert.equal(readdirSync(dir).filter((f) => f.endsWith(".tmp")).length, 0);
});
