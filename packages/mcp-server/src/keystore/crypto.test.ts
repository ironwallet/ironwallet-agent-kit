import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptSecret, encryptSecret, type EncryptedBlob } from "./crypto.js";

const PASS = "correct horse battery staple";
const SECRET = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

function withTag(blobJson: string, tag: Buffer): string {
  const blob = JSON.parse(blobJson) as EncryptedBlob;
  return JSON.stringify({ ...blob, tag: tag.toString("base64") });
}

test("encryptSecret round-trips with a full 16-byte tag", () => {
  const blob = encryptSecret(SECRET, PASS);
  assert.equal(Buffer.from((JSON.parse(blob) as EncryptedBlob).tag, "base64").length, 16);
  assert.equal(decryptSecret(blob, PASS), SECRET);
});

test("decryptSecret rejects a truncated tag even when its prefix is genuine", () => {
  const blob = encryptSecret(SECRET, PASS);
  const tag = Buffer.from((JSON.parse(blob) as EncryptedBlob).tag, "base64");
  for (const len of [4, 8, 12, 15]) {
    assert.throws(() => decryptSecret(withTag(blob, tag.subarray(0, len)), PASS), /Failed to decrypt wallet/);
  }
});

test("decryptSecret rejects a tampered tag and a wrong passphrase", () => {
  const blob = encryptSecret(SECRET, PASS);
  const tag = Buffer.from((JSON.parse(blob) as EncryptedBlob).tag, "base64");
  tag[0] ^= 1;
  assert.throws(() => decryptSecret(withTag(blob, tag), PASS), /Failed to decrypt wallet/);
  assert.throws(() => decryptSecret(blob, "wrong"), /Failed to decrypt wallet/);
});
