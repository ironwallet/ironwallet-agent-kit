import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import {
  resolveWindowsUsername,
  windowsIcaclsArgs,
  windowsIcaclsPath,
} from "./restrict-private-file.js";

test("windowsIcaclsArgs drops inheritance and grants the user full control", () => {
  assert.deepEqual(windowsIcaclsArgs("C:\\Users\\me\\.ironwallet-mcp\\keystore.json", "alice"), [
    "C:\\Users\\me\\.ironwallet-mcp\\keystore.json",
    "/inheritance:r",
    "/grant:r",
    "alice:F",
  ]);
});

test("windowsIcaclsPath uses System32 under the Windows root", () => {
  assert.equal(windowsIcaclsPath("D:\\Windows"), join("D:\\Windows", "System32", "icacls.exe"));
});

test("resolveWindowsUsername prefers the OS account over USERNAME", () => {
  assert.equal(resolveWindowsUsername("alice", "bob"), "alice");
});

test("resolveWindowsUsername falls back to USERNAME", () => {
  assert.equal(resolveWindowsUsername("  ", "  bob  "), "bob");
});
