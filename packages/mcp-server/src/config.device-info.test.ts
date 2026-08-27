import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultDeviceInfo } from "./config.js";

test("defaultDeviceInfo is Web, not a phone spoof", () => {
  const info = JSON.parse(defaultDeviceInfo()) as Record<string, string>;
  assert.equal(info.systemName, "Web");
  assert.equal(info.model, "ironwallet-mcp");
  assert.equal(info.platform, process.platform);
  assert.doesNotMatch(JSON.stringify(info), /iPhone|iOS|Android/i);
});
