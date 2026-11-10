/**
 * HTTP-level tests for the manager's app shell and JSON API: routing under the
 * capability path, Host / Origin gating, and the consent endpoints. Runs the
 * real server on 127.0.0.1 against a throwaway keystore directory.
 */
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "iw-manager-api-"));
process.env.IW_KEYSTORE_DIR = dir;
process.env.IW_PASSPHRASE = "test-passphrase-not-secret";
process.env.IW_LOG_FILE = "";

const { ensureManager, closeManager } = await import("./manager.js");
const { APP_CSP } = await import("./security.js");

let base = ""; // http://127.0.0.1:port/<token>
let origin = "";

before(async () => {
  base = await ensureManager();
  origin = new URL(base).origin;
});

after(() => {
  closeManager();
  rmSync(dir, { recursive: true, force: true });
});

function postJson(sub: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}/api${sub}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...headers },
    body: JSON.stringify(body),
  });
}

/** Raw request: fetch cannot forge Host or send an un-normalised path. */
function raw(path: string, headers: Record<string, string> = {}): Promise<number> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request(
      { host: url.hostname, port: url.port, path, method: "GET", headers },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("the bare capability URL redirects to its trailing-slash form", async () => {
  const r = await fetch(base, { redirect: "manual" });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), `${new URL(base).pathname}/`);
});

test("the app document carries the strict CSP (or reports a missing build)", async () => {
  const r = await fetch(`${base}/`);
  if (r.status === 503) {
    assert.match(await r.text(), /not built/);
    return;
  }
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-security-policy"), APP_CSP);
  assert.doesNotMatch(APP_CSP, /unsafe-inline|unsafe-eval/);
});

test("a foreign Host header is refused (DNS rebinding)", async () => {
  const { pathname, port } = new URL(base);
  assert.equal(await raw(`${pathname}/api/session`, { host: `evil.example:${port}` }), 421);
  assert.equal(await raw(`${pathname}/api/session`), 200);
});

test("static files cannot escape the bundle directory", async () => {
  const { pathname } = new URL(base);
  assert.equal(await raw(`${pathname}/static/..%2F..%2Fpackage.json`), 404);
  assert.equal(await raw(`${pathname}/static/../../package.json`), 404);
  assert.equal(await raw(`${pathname}/static/.hidden.js`), 404);
});

test("session reports the disclaimer as not yet accepted, uncached", async () => {
  const r = await fetch(`${base}/api/session`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control") ?? "", /no-store/);
  const body = (await r.json()) as {
    version: string;
    readOnly: boolean;
    consent: { accepted: boolean; bullets: string[]; title: string };
  };
  assert.equal(body.consent.accepted, false);
  assert.ok(body.consent.bullets.length > 0);
  assert.ok(body.consent.title);
  assert.equal(typeof body.readOnly, "boolean");
});

test("API writes need same-origin JSON", async () => {
  const noOrigin = await fetch(`${base}/api/consent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ understood: true }),
  });
  assert.equal(noOrigin.status, 403);

  const foreign = await postJson("/consent", { understood: true }, { origin: "https://evil.example" });
  assert.equal(foreign.status, 403);

  const form = await fetch(`${base}/api/consent`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin },
    body: "understood=true",
  });
  assert.equal(form.status, 403);
  assert.equal(((await form.json()) as { error: { code: string } }).error.code, "forbidden");

  const session = (await (await fetch(`${base}/api/session`)).json()) as { consent: { accepted: boolean } };
  assert.equal(session.consent.accepted, false);
});

test("consent needs understood: true, then the session reports it accepted", async () => {
  const unchecked = await postJson("/consent", { understood: "yes" });
  assert.equal(unchecked.status, 400);

  const ok = await postJson("/consent", { understood: true });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { accepted: true });

  const session = (await (await fetch(`${base}/api/session`)).json()) as { consent: { accepted: boolean } };
  assert.equal(session.consent.accepted, true);
});

test("malformed, oversized and unknown requests get JSON errors", async () => {
  const bad = await fetch(`${base}/api/consent`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: "{not json",
  });
  assert.equal(bad.status, 400);

  const big = await postJson("/consent", { understood: true, pad: "x".repeat(70 * 1024) });
  assert.equal(big.status, 413);

  const unknown = await fetch(`${base}/api/nope`);
  assert.equal(unknown.status, 404);
  assert.equal(((await unknown.json()) as { error: { code: string } }).error.code, "not_found");
});
