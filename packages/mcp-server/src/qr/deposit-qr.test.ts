import assert from "node:assert/strict";
import { test } from "node:test";
import {
  depositPayload,
  depositQrUrl,
  renderDepositQrPng,
  selectDepositTargets,
  uniqueDepositTargets,
  walletOwnsDeposit,
} from "./deposit-qr.js";

test("depositQrUrl points at the manager PNG route", () => {
  assert.equal(
    depositQrUrl(
      "http://127.0.0.1:9/aabb",
      "ethereum",
      "0xAbc",
    ),
    "http://127.0.0.1:9/aabb/qr?network=ethereum&address=0xAbc",
  );
});

test("depositPayload uses chain URIs", () => {
  assert.equal(depositPayload("ethereum", "0xAbc"), "ethereum:0xAbc");
  assert.equal(depositPayload("bsc", "0xAbc"), "ethereum:0xAbc");
  assert.equal(depositPayload("bitcoin", "bc1qtest"), "bitcoin:bc1qtest");
  assert.equal(depositPayload("ton", "EQabc"), "ton://transfer/EQabc");
});

test("selectDepositTargets filters by network", () => {
  const addresses = { ethereum: "0xaaa", tron: "Txyz" };
  assert.deepEqual(selectDepositTargets(addresses, "tron"), [
    { network: "tron", address: "Txyz" },
  ]);
  assert.equal(selectDepositTargets(addresses).length, 2);
  assert.equal(walletOwnsDeposit(addresses, "ethereum", "0xaaa"), true);
  assert.equal(walletOwnsDeposit(addresses, "ethereum", "0xbbb"), false);
});

test("uniqueDepositTargets collapses shared EVM address", () => {
  const rows = uniqueDepositTargets({
    ethereum: "0xaaa",
    bsc: "0xaaa",
    tron: "Txyz",
    bitcoin: "bc1q",
  });
  assert.deepEqual(
    rows.map((r) => r.network),
    ["ethereum", "tron", "bitcoin"],
  );
});

test("renderDepositQrPng writes a PNG with the IW mark", async () => {
  const buf = await renderDepositQrPng(
    "0x1234567890abcdef1234567890abcdef12345678",
    "ethereum:0x1234567890abcdef1234567890abcdef12345678",
  );
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.ok(buf.length > 800);
});
