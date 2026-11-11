/**
 * Retries in httpJson: on by default for GET, off for every call made inside
 * withoutRetries (the manager's balance reads).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

let hits = 0;
let mock: Server;

async function startMock(): Promise<string> {
  mock = createServer((_req, res) => {
    hits++;
    const ok = hits % 2 === 0;
    res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify(ok ? { ok: true } : { error: "busy" }));
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
}

const url = `${await startMock()}/flaky`;
const dir = mkdtempSync(join(tmpdir(), "iw-http-"));
process.env.IW_KEYSTORE_DIR = dir;
process.env.IW_LOG_FILE = "";
process.env.IW_HTTP_RETRIES = "1";

const { httpJson, withoutRetries } = await import("./http.js");

after(() => {
  mock.close();
  rmSync(dir, { recursive: true, force: true });
});

test("a GET that hits a 503 is retried", async () => {
  hits = 0;
  assert.deepEqual(await httpJson(url, { method: "GET" }), { ok: true });
  assert.equal(hits, 2);
});

test("inside withoutRetries the same GET fails on the first 503, including nested calls", async () => {
  hits = 0;
  await assert.rejects(
    withoutRetries(async () => {
      await Promise.resolve();
      return httpJson(url, { method: "GET" });
    }),
    (e: Error & { status?: number }) => e.status === 503,
  );
  assert.equal(hits, 1);
});
