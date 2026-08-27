import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertUsdWithinLimit,
  compareDecimalAmount,
  enforcePolicy,
  multiplyDecimalAmounts,
  numberToDecimalString,
} from "./policy.js";
import type { WalletEntry } from "./keystore/types.js";

function entryWithAllowList(): WalletEntry {
  return {
    name: "hot",
    encSeed: "{}",
    addresses: {},
    backedUp: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    policy: {
      enabled: true,
      allowedRecipients: ["0x52908400098527886E0F7030069857D2E4169EE7"],
    },
  };
}

test("recipient allow-list does not block swaps", () => {
  assert.doesNotThrow(() =>
    enforcePolicy(entryWithAllowList(), { kind: "swap", network: "ethereum" }),
  );
});

test("recipient allow-list still blocks transfers to unlisted addresses", () => {
  const entry = entryWithAllowList();
  assert.doesNotThrow(() =>
    enforcePolicy(entry, {
      kind: "transfer",
      network: "ethereum",
      // Same address, different casing — must match via normalization.
      toAddress: "0x52908400098527886e0f7030069857d2e4169ee7",
    }),
  );
  assert.throws(
    () =>
      enforcePolicy(entry, {
        kind: "transfer",
        network: "ethereum",
        toAddress: "0x8617E340B3D01FA5F11F306F4090FD50E238070D",
      }),
    /not in the whitelist/,
  );
});

test("multiplyDecimalAmounts is exact for typical amount × rate", () => {
  assert.equal(multiplyDecimalAmounts("2", "3"), "6");
  assert.equal(multiplyDecimalAmounts("0.5", "4123.55"), "2061.775");
  assert.equal(multiplyDecimalAmounts("1000000", "0.999998"), "999998");
  assert.equal(multiplyDecimalAmounts("0.000000000000000001", "4000"), "0.000000000000004");
  assert.equal(multiplyDecimalAmounts("12.25", "0"), "0");
  // Float math would give 0.30000000000000004 here.
  assert.equal(multiplyDecimalAmounts("0.1", "3"), "0.3");
});

test("multiplyDecimalAmounts rejects invalid input", () => {
  assert.throws(() => multiplyDecimalAmounts("-1", "2"));
  assert.throws(() => multiplyDecimalAmounts("1,5", "2"));
  assert.throws(() => multiplyDecimalAmounts("abc", "2"));
});

test("numberToDecimalString expands exponent notation", () => {
  assert.equal(numberToDecimalString(4123.55), "4123.55");
  assert.equal(numberToDecimalString(1e-7), "0.0000001");
  assert.equal(numberToDecimalString(0), "0");
  assert.throws(() => numberToDecimalString(Number.NaN));
  assert.throws(() => numberToDecimalString(-1));
});

test("assertUsdWithinLimit passes under the limit and reports usd value", () => {
  const { usdValue } = assertUsdWithinLimit({
    wallet: "hot",
    kind: "transfer",
    amount: "0.01",
    rate: 4000,
    maxPerTxUsd: "50",
    assetLabel: "ETH",
  });
  assert.equal(usdValue, "40");
});

test("assertUsdWithinLimit rejects over the limit with a clear message", () => {
  assert.throws(
    () =>
      assertUsdWithinLimit({
        wallet: "hot",
        kind: "swap",
        amount: "100",
        rate: 1.0001,
        maxPerTxUsd: "100",
        assetLabel: "USDT",
      }),
    /exceeds the 100 USD per-transaction limit/,
  );
});

test("boundary: exactly at the limit is allowed", () => {
  const { usdValue } = assertUsdWithinLimit({
    wallet: "hot",
    kind: "transfer",
    amount: "50",
    rate: 1,
    maxPerTxUsd: "50",
    assetLabel: "USDC",
  });
  assert.equal(usdValue, "50");
  assert.equal(compareDecimalAmount(usdValue, "50"), 0);
});
