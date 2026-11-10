import assert from "node:assert/strict";
import { test } from "node:test";

process.env.IW_STATIC_RESOURCES_URL = "https://static.example";
process.env.IW_STATIC_ASSETS_BRANCH = "main";

const { assetIconPath, catalogAssets, NATIVE_ASSET_ID } = await import("./catalog.js");

const DOC = {
  assets: [
    {
      asset_id: "usdt1",
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      symbol: "usdt",
      name: "Tether",
      decimals: 6,
      default: true,
      type: "ERC20",
      logoUri: "/assets/usdt1/logo.png",
      status: "active",
    },
    { asset_id: "eth1", symbol: "ETH", name: "ETH", decimals: 18, default: true, logoUri: "assets/eth1/logo.png" },
    { asset_id: "weth1", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", decimals: 18 },
    { asset_id: "old1", address: "0x1111111111111111111111111111111111111111", symbol: "OLD", decimals: 18, status: "disabled" },
    { asset_id: "nodec", address: "0x2222222222222222222222222222222222222222", symbol: "NODEC" },
    { asset_id: "usdt1", address: "0x3333333333333333333333333333333333333333", symbol: "DUP", decimals: 6 },
    { address: "0x4444444444444444444444444444444444444444", symbol: "NOID", decimals: 6 },
  ],
};

test("catalogAssets keeps active entries, native first, with display fields", () => {
  const assets = catalogAssets("ethereum", DOC);
  assert.deepEqual(
    assets.map((a) => a.assetId),
    ["eth1", "usdt1", "weth1"],
  );
  const [eth, usdt, weth] = assets;
  assert.equal(eth.address, null);
  assert.equal(eth.isDefault, true);
  assert.equal(eth.standard, undefined);
  assert.equal(usdt.symbol, "USDT");
  assert.equal(usdt.standard, "ERC20");
  assert.equal(usdt.decimals, 6);
  assert.equal(weth.isDefault, false);
  assert.equal(weth.name, "WETH");
});

test("catalogAssets synthesizes the native coin when the catalog is missing", () => {
  const [native, ...rest] = catalogAssets("doge", undefined);
  assert.deepEqual(rest, []);
  assert.equal(native.assetId, NATIVE_ASSET_ID);
  assert.equal(native.symbol, "DOGE");
  assert.equal(native.decimals, 8);
  assert.equal(native.isDefault, true);
});

test("assetIconPath maps catalog paths and refuses anything else", () => {
  const [eth, usdt, weth] = catalogAssets("ethereum", DOC);
  assert.equal(assetIconPath(eth), "/assets/main/blockchains/ethereum/assets/eth1/logo.png");
  assert.equal(assetIconPath(usdt), "/assets/main/blockchains/ethereum/assets/usdt1/logo.png");
  assert.equal(assetIconPath(weth), null);
  assert.equal(assetIconPath({ ...eth, logoUri: "../../secret.png" }), null);
  assert.equal(assetIconPath({ ...eth, logoUri: "assets/x/logo.svg" }), null);
  assert.equal(
    assetIconPath({ ...catalogAssets("doge", undefined)[0], logoUri: "assets/d1/logo.png" }),
    "/assets/main/blockchains/dogecoin/assets/d1/logo.png",
  );
});
