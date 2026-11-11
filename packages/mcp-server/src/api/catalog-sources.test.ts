/**
 * Catalog host chain: CDN hosts in order, the MCP proxy last. The mock has a
 * CDN that refuses connections, a CDN that only has the Tron catalog and
 * never answers for Base, and a proxy that answers only with the client
 * header.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const DOC = { assets: [{ asset_id: "usdt", address: "0xdead", symbol: "USDT", decimals: 6, default: true }] };
const ARB = { assets: [{ asset_id: "arb", symbol: "ARB", decimals: 18 }] };
const ARB_ETAG = 'W/"arb-1"';
const ARB_MODIFIED = "Wed, 21 Oct 2026 09:02:28 GMT";

const seen: Array<{ path: string; client?: string; ifNoneMatch?: string; ifModifiedSince?: string }> = [];
let mock: Server;
let tronGone = false;

async function startMock(): Promise<string> {
  mock = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://mock").pathname;
    const client = req.headers["x-iwt-cli"] as string | undefined;
    seen.push({
      path,
      client,
      ifNoneMatch: req.headers["if-none-match"],
      ifModifiedSince: req.headers["if-modified-since"],
    });
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (path === "/cdn2/Ironwallet/assets/staging/blockchains/tron/assets.mainnet.json" && !tronGone) {
      return json(200, DOC);
    }
    if (path === "/cdn2/Ironwallet/assets/staging/blockchains/arbitrum/assets.mainnet.json") {
      const validators = { etag: ARB_ETAG, "last-modified": ARB_MODIFIED };
      if (req.headers["if-modified-since"] === ARB_MODIFIED) {
        res.writeHead(304, validators);
        return res.end();
      }
      res.writeHead(200, { "content-type": "application/json", ...validators });
      return res.end(JSON.stringify(ARB));
    }
    if (path === "/cdn2/Ironwallet/assets/staging/blockchains/base/assets.mainnet.json") return;
    if (path.startsWith("/proxy/")) {
      if (!client?.startsWith("ironwallet-mcp/")) return json(403, { error: "client_header_missing" });
      if (path === "/proxy/Ironwallet/assets/staging/blockchains/ethereum/assets.mainnet.json") return json(200, DOC);
      if (path === "/proxy/Ironwallet/assets/staging/blockchains/base/assets.mainnet.json") return json(200, DOC);
    }
    json(404, {});
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
}

async function closedPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return port;
}

const mockBase = await startMock();
const deadCdn = `http://127.0.0.1:${await closedPort()}/Ironwallet`;
const liveCdn = `${mockBase}/cdn2/Ironwallet`;
const proxy = `${mockBase}/proxy/Ironwallet`;
const dir = mkdtempSync(join(tmpdir(), "iw-catalog-sources-"));

process.env.IW_KEYSTORE_DIR = dir;
process.env.IW_LOG_FILE = "";
process.env.IW_STATIC_CDN_URLS = `${deadCdn}, ${liveCdn}/`;
process.env.IW_STATIC_RESOURCES_URL = proxy;
process.env.IW_STATIC_ASSETS_BRANCH = "staging";

const { expireCatalogCache, fetchCatalog, markStaticHostDown, markStaticHostOk, staticRequests, warmCatalogs } =
  await import("./catalog.js");

const diskDir = join(dir, "catalog-cache", "staging");

function saveOnDisk(network: string, savedAt: number, doc: unknown, validators: Record<string, string> = {}): void {
  mkdirSync(diskDir, { recursive: true });
  writeFileSync(join(diskDir, `${network}.json`), JSON.stringify({ savedAt, doc, ...validators }));
}

function requestsFor(network: string): number {
  return seen.filter((s) => s.path.endsWith(`/${network}/assets.mainnet.json`)).length;
}

after(() => {
  mock.closeAllConnections();
  mock.close();
  rmSync(dir, { recursive: true, force: true });
});

test("CDN hosts come first without device headers, the proxy last with them", () => {
  const reqs = staticRequests("/x.json");
  assert.deepEqual(
    reqs.map((r) => r.url),
    [`${deadCdn}/x.json`, `${liveCdn}/x.json`, `${proxy}/x.json`],
  );
  assert.equal(reqs[0].headers, undefined);
  assert.equal(reqs[1].headers, undefined);
  assert.match(reqs[2].headers?.["x-iwt-cli"] ?? "", /^ironwallet-mcp\//);
});

test("a CDN that refuses connections is skipped and moved to the end", async () => {
  assert.deepEqual(await fetchCatalog("tron"), DOC);
  assert.deepEqual(
    staticRequests("/x.json").map((r) => r.base),
    [liveCdn, deadCdn, proxy],
  );
});

test("a catalog missing on every CDN comes from the proxy with the client header", async () => {
  assert.deepEqual(await fetchCatalog("ethereum"), DOC);
  const eth = seen.filter((s) => s.path.endsWith("/ethereum/assets.mainnet.json"));
  assert.deepEqual(
    eth.map((s) => s.path.split("/")[1]),
    ["cdn2", "proxy"],
  );
  assert.equal(eth[0].client, undefined);
  assert.match(eth[1].client ?? "", /^ironwallet-mcp\//);
});

test("nothing anywhere means no catalog", async () => {
  assert.equal(await fetchCatalog("solana"), undefined);
});

test("a fetched catalog is saved on disk under the assets branch", () => {
  const saved = JSON.parse(readFileSync(join(diskDir, "tron.json"), "utf8")) as { savedAt: number; doc: unknown };
  assert.deepEqual(saved.doc, DOC);
  assert.ok(Date.now() - saved.savedAt < 60_000);
  assert.equal(existsSync(join(diskDir, "solana.json")), false);
});

test("a fresh copy saved by an earlier run is served without the network", async () => {
  const own = { assets: [{ asset_id: "pol", symbol: "POL", decimals: 18 }] };
  saveOnDisk("polygon", Date.now() - 60_000, own);
  assert.deepEqual(await fetchCatalog("polygon"), own);
  assert.equal(requestsFor("polygon"), 0);
});

test("a stale copy on disk is served at once and refetched in the background", async () => {
  const old = { assets: [{ asset_id: "avax", symbol: "AVAX", decimals: 18 }] };
  saveOnDisk("avalanche", Date.now() - 7 * 60 * 60 * 1000, old);
  assert.deepEqual(await fetchCatalog("avalanche"), old);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(requestsFor("avalanche") > 0, "refetched in the background");
  assert.deepEqual(await fetchCatalog("avalanche"), old, "a failed refetch keeps the disk copy");
});

test("a broken file on disk is ignored", async () => {
  mkdirSync(diskDir, { recursive: true });
  writeFileSync(join(diskDir, "optimism.json"), "{ not json");
  assert.equal(await fetchCatalog("optimism"), undefined);
  assert.ok(requestsFor("optimism") > 0);
});

test("a host that never answers costs the hedge delay, not its timeout", async () => {
  const started = Date.now();
  assert.deepEqual(await fetchCatalog("base"), DOC);
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 1400 && elapsed < 5000, `took ${elapsed}ms`);
  const base = seen.filter((s) => s.path.endsWith("/base/assets.mainnet.json")).map((s) => s.path.split("/")[1]);
  assert.deepEqual(base, ["cdn2", "proxy"]);
});

test("when every CDN is down the longest-failed goes first, and a success moves a host to the front", () => {
  markStaticHostDown(liveCdn);
  assert.deepEqual(
    staticRequests("/x.json").map((r) => r.base),
    [deadCdn, liveCdn, proxy],
  );
  markStaticHostOk(liveCdn);
  assert.deepEqual(
    staticRequests("/x.json").map((r) => r.base),
    [liveCdn, deadCdn, proxy],
  );
});

test("warmCatalogs fills every network once and the second pass is a cache hit", async () => {
  const before = seen.length;
  await warmCatalogs();
  assert.ok(seen.length > before);
  assert.deepEqual(await fetchCatalog("tron"), DOC);
  assert.equal(await fetchCatalog("bitcoin"), undefined);
  const cached = seen.length;
  await warmCatalogs();
  assert.equal(seen.length, cached);
});

test("a due refetch serves the last good copy at once and keeps it when every host fails", async () => {
  tronGone = true;
  try {
    expireCatalogCache();
    const before = seen.length;
    assert.deepEqual(await fetchCatalog("tron"), DOC);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.ok(seen.slice(before).some((s) => s.path.endsWith("/tron/assets.mainnet.json")), "refetched in the background");
    assert.deepEqual(await fetchCatalog("tron"), DOC);
  } finally {
    tronGone = false;
  }
});

test("an unchanged catalog is revalidated by Last-Modified, and the bodiless 304 extends the copy on disk", async () => {
  const saved = JSON.parse(readFileSync(join(diskDir, "arbitrum.json"), "utf8")) as Record<string, unknown>;
  assert.equal(saved.etag, ARB_ETAG);
  assert.equal(saved.lastModified, ARB_MODIFIED);
  saveOnDisk("arbitrum", Date.now() - 7 * 60 * 60 * 1000, ARB, { etag: ARB_ETAG, lastModified: ARB_MODIFIED });
  expireCatalogCache();
  assert.deepEqual(await fetchCatalog("arbitrum"), ARB);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const last = seen.filter((s) => s.path.endsWith("/arbitrum/assets.mainnet.json")).at(-1);
  assert.equal(last?.ifModifiedSince, ARB_MODIFIED);
  assert.equal(last?.ifNoneMatch, undefined, "If-None-Match would make the server ignore If-Modified-Since");
  const after304 = JSON.parse(readFileSync(join(diskDir, "arbitrum.json"), "utf8")) as { savedAt: number; doc: unknown };
  assert.ok(Date.now() - after304.savedAt < 60_000, "the 304 refreshed savedAt");
  assert.deepEqual(after304.doc, ARB);
  assert.deepEqual(await fetchCatalog("arbitrum"), ARB);
});
