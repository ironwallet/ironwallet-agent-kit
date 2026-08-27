import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { CONSENT_VERSION } from "./copy.js";
import {
  CONSENT_FILE,
  consentRequiredPayload,
  hasCurrentConsent,
  readConsent,
  recordConsent,
} from "./store.js";

const dirs: string[] = [];

function tmpKeystore(): string {
  const dir = mkdtempSync(join(tmpdir(), "iw-consent-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hasCurrentConsent is false when the file is missing", () => {
  assert.equal(hasCurrentConsent(tmpKeystore()), false);
});

test("recordConsent writes version, time, and channel", () => {
  const dir = tmpKeystore();
  const before = Date.now();
  const record = recordConsent("chat", dir);
  assert.equal(record.version, CONSENT_VERSION);
  assert.equal(record.channel, "chat");
  assert.ok(Date.parse(record.acceptedAt) >= before - 1000);
  const onDisk = JSON.parse(readFileSync(join(dir, CONSENT_FILE), "utf8"));
  assert.deepEqual(onDisk, record);
  assert.equal(hasCurrentConsent(dir), true);
  assert.deepEqual(readConsent(dir), record);
});

test("stale consent version does not unlock create", () => {
  const dir = tmpKeystore();
  writeFileSync(
    join(dir, CONSENT_FILE),
    `${JSON.stringify({ version: "v0", acceptedAt: "2020-01-01T00:00:00.000Z", channel: "chat" }, null, 2)}\n`,
    "utf8",
  );
  assert.equal(hasCurrentConsent(dir), false);
  assert.equal(readConsent(dir)?.version, "v0");
});

test("corrupt consent file is treated as missing", () => {
  const dir = tmpKeystore();
  writeFileSync(join(dir, CONSENT_FILE), "{not-json", "utf8");
  assert.equal(readConsent(dir), undefined);
  assert.equal(hasCurrentConsent(dir), false);
});

test("consentRequiredPayload points at accept_mcp_consent and current copy", () => {
  const payload = consentRequiredPayload();
  assert.equal(payload.needs_consent, true);
  assert.equal(payload.accept, "accept_mcp_consent");
  assert.equal(payload.consent.version, CONSENT_VERSION);
  assert.ok(payload.consent.bullets.length >= 4);
});
