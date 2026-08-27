import assert from "node:assert/strict";
import { test } from "node:test";
import { ALL_NETWORKS } from "../networks.js";
import {
  NATIVE_EXTERNAL_ID,
  findExternalIdInCatalog,
  parseUsdRate,
  sameTokenAddress,
  type RatesResponse,
} from "./rates.js";

test("every network has a native externalId", () => {
  for (const net of ALL_NETWORKS) {
    const id = NATIVE_EXTERNAL_ID[net];
    assert.ok(id && id.length > 0, `missing native externalId for ${net}`);
  }
});

test("sameTokenAddress: EVM hex is case-insensitive, base58 is exact", () => {
  assert.ok(
    sameTokenAddress(
      "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      "0xdac17f958d2ee523a2206206994597c13d831ec7",
    ),
  );
  assert.ok(sameTokenAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"));
  assert.ok(!sameTokenAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "tr7nhqjekqxgtci8q8zy4pl8otszgjlj6t"));
});

const CATALOG = {
  assets: [
    { symbol: "ETH", externalId: "ethereum" },
    {
      symbol: "USDT",
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      externalId: "tether",
    },
    { symbol: "MYSTERY", address: "0x1111111111111111111111111111111111111111" },
  ],
};

test("findExternalIdInCatalog matches tokens by address first", () => {
  assert.equal(
    findExternalIdInCatalog(CATALOG, {
      symbol: "WRONG",
      tokenAddress: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    }),
    "tether",
  );
});

test("findExternalIdInCatalog falls back to the native symbol", () => {
  assert.equal(findExternalIdInCatalog(CATALOG, { symbol: "eth" }), "ethereum");
});

test("findExternalIdInCatalog returns undefined for unknown or id-less assets", () => {
  assert.equal(
    findExternalIdInCatalog(CATALOG, {
      tokenAddress: "0x2222222222222222222222222222222222222222",
    }),
    undefined,
  );
  assert.equal(
    findExternalIdInCatalog(CATALOG, {
      tokenAddress: "0x1111111111111111111111111111111111111111",
    }),
    undefined,
  );
});

test("parseUsdRate reads the mobile response shape", () => {
  const response: RatesResponse = {
    ethereum: { usd: { value: 4123.55, dailyChange: -1.2, isExpired: false } },
  };
  assert.deepEqual(parseUsdRate(response, "ethereum"), {
    value: 4123.55,
    isExpired: false,
  });
});

test("parseUsdRate handles currency key casing and missing data", () => {
  assert.equal(
    parseUsdRate({ tether: { USD: { value: 1.0002 } } }, "tether")?.value,
    1.0002,
  );
  assert.equal(parseUsdRate({}, "ethereum"), undefined);
  assert.equal(parseUsdRate({ ethereum: null }, "ethereum"), undefined);
  assert.equal(parseUsdRate({ ethereum: { usd: { value: 0 } } }, "ethereum"), undefined);
  assert.equal(parseUsdRate({ ethereum: { eur: { value: 5 } } }, "ethereum"), undefined);
});

test("parseUsdRate flags expired rates without dropping them", () => {
  const rate = parseUsdRate(
    { bitcoin: { usd: { value: 65000, isExpired: true } } },
    "bitcoin",
  );
  assert.deepEqual(rate, { value: 65000, isExpired: true });
});
