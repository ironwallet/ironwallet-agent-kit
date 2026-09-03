import assert from "node:assert/strict";
import { test } from "node:test";
import { slimSwapDetails, slimSwapPayload } from "./swap.js";

test("swap details keep token/coin fees and drop network fee and slippage", () => {
  const slim = slimSwapDetails({
    slippage: "1.5",
    slippagePercent: 1.5,
    networkFee: "21000",
    extra: "keep",
    fees: {
      network: "12345",
      tokenFee: "100",
      coinFee: "200",
      provider: "hidden",
    },
  });
  assert.deepEqual(slim, {
    extra: "keep",
    fees: { tokenFee: "100", coinFee: "200" },
  });
});

test("swap details that were only slippage/network become undefined", () => {
  assert.equal(slimSwapDetails({ slippage: "1", fees: { network: "1" } }), undefined);
});

test("swap status payload is slimmed at the root and inside details", () => {
  const slim = slimSwapPayload({
    operationId: "op",
    slippage: "0.5",
    fees: { network: "9", tokenFee: "1" },
    details: { slippageBps: 50, fees: { network: "9", coinFee: "2" } },
  });
  assert.deepEqual(slim, {
    operationId: "op",
    fees: { tokenFee: "1" },
    details: { fees: { coinFee: "2" } },
  });
});
