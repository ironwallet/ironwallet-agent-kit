import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "iw-log-"));
process.env.IW_LOG_ENABLED = "1";
process.env.IW_LOG_FILE = join(dir, "nested", "custom.jsonl");
const { logInfo, pruneOldLogs } = await import("./log.js");

after(() => rmSync(dir, { recursive: true, force: true }));

const DAY = 24 * 60 * 60 * 1000;
const posix = process.platform !== "win32";

test("log file is created owner-only", () => {
  logInfo("test.event", { toAddress: "0xabc" });
  const file = process.env.IW_LOG_FILE!;
  assert.match(readFileSync(file, "utf8"), /"event":"test\.event"/);
  if (posix) {
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, "nested")).mode & 0o777, 0o700);
  }
});

test("pruneOldLogs drops stale daily files and keeps the rest", () => {
  const logs = mkdtempSync(join(dir, "logs-"));
  const now = Date.now();
  const stale = join(logs, "iw-mcp-2026-01-01.jsonl");
  const fresh = join(logs, "iw-mcp-2026-09-29.jsonl");
  const foreign = join(logs, "notes.jsonl");
  for (const f of [stale, fresh, foreign]) writeFileSync(f, "{}\n", { mode: 0o644 });
  const old = new Date(now - 30 * DAY);
  utimesSync(stale, old, old);
  utimesSync(foreign, old, old);

  pruneOldLogs(logs, now, 14);

  assert.equal(existsSync(stale), false);
  assert.equal(existsSync(fresh), true);
  assert.equal(existsSync(foreign), true, "only default-named daily files are pruned");
  if (posix) assert.equal(statSync(fresh).mode & 0o777, 0o600);
});

test("pruneOldLogs ignores a missing directory", () => {
  assert.doesNotThrow(() => pruneOldLogs(join(dir, "missing")));
});
