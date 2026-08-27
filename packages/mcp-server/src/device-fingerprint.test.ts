import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FINGERPRINT_VERSION,
  formatDeviceFingerprint,
  parseLinuxMachineId,
  parseMacPlatformUuid,
  parseWindowsMachineGuid,
} from "./device-fingerprint.js";

const base = {
  osMachineId: "a1b2c3d4e5f64789a1b2c3d4e5f64789",
  platform: "win32",
};

test("formatDeviceFingerprint is stable and version-prefixed", () => {
  const a = formatDeviceFingerprint(base);
  const b = formatDeviceFingerprint(base);
  assert.equal(a, b);
  assert.match(a, new RegExp(`^${FINGERPRINT_VERSION}:[0-9a-f]{64}$`));
});

test("formatDeviceFingerprint changes when the OS machine id changes", () => {
  const a = formatDeviceFingerprint(base);
  const b = formatDeviceFingerprint({ ...base, osMachineId: "ffffffffffffffffffffffffffffffff" });
  assert.notEqual(a, b);
});

test("formatDeviceFingerprint ignores fallback when machine id is present", () => {
  const a = formatDeviceFingerprint(base);
  const b = formatDeviceFingerprint({ ...base, fallbackId: "11111111-1111-4111-8111-111111111111" });
  assert.equal(a, b);
});

test("formatDeviceFingerprint uses device-id when machine id is missing", () => {
  const a = formatDeviceFingerprint({
    platform: "win32",
    fallbackId: "11111111-1111-4111-8111-111111111111",
  });
  const b = formatDeviceFingerprint({
    platform: "win32",
    fallbackId: "22222222-2222-4222-8222-222222222222",
  });
  const same = formatDeviceFingerprint({
    platform: "win32",
    osMachineId: "  ",
    fallbackId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(a, same);
  assert.notEqual(a, b);
});

test("parseWindowsMachineGuid reads MachineGuid", () => {
  const output = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography
    MachineGuid    REG_SZ    9F3A1C2E-4B56-7890-ABCD-EF1234567890
`;
  assert.equal(parseWindowsMachineGuid(output), "9f3a1c2e-4b56-7890-abcd-ef1234567890");
});

test("parseMacPlatformUuid reads IOPlatformUUID", () => {
  const output = `
    "IOPlatformUUID" = "AABBCCDD-EEFF-0011-2233-445566778899"
`;
  assert.equal(parseMacPlatformUuid(output), "aabbccdd-eeff-0011-2233-445566778899");
});

test("parseLinuxMachineId strips whitespace", () => {
  assert.equal(
    parseLinuxMachineId("  A1B2C3D4E5F64789A1B2C3D4E5F64789\n"),
    "a1b2c3d4e5f64789a1b2c3d4e5f64789",
  );
  assert.equal(parseLinuxMachineId("short"), undefined);
});
