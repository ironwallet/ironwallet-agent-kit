/**
 * Stable machine fingerprint for `X-Device-Fingerprint`.
 *
 * Hashes the OS install id (Linux machine-id, Windows MachineGuid,
 * macOS IOPlatformUUID) plus platform. If that id is missing, hashes the
 * local `device-id` UUID instead. Hostname, username, and arch are never
 * included. Computed in memory only — not written under ~/.ironwallet-mcp/.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const FINGERPRINT_VERSION = "v1";

export function parseWindowsMachineGuid(regOutput: string): string | undefined {
  const match = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/.exec(regOutput);
  return match?.[1]?.toLowerCase();
}

export function parseMacPlatformUuid(ioregOutput: string): string | undefined {
  const match = /"IOPlatformUUID"\s*=\s*"([0-9a-fA-F-]{36})"/.exec(ioregOutput);
  return match?.[1]?.toLowerCase();
}

export function parseLinuxMachineId(raw: string): string | undefined {
  const id = raw.trim().toLowerCase().replace(/[^0-9a-f]/g, "");
  return id.length >= 16 ? id : undefined;
}

export function formatDeviceFingerprint(parts: {
  osMachineId?: string;
  platform: string;
  fallbackId?: string;
}): string {
  const machineId = parts.osMachineId?.trim() ?? "";
  const fallbackId = parts.fallbackId?.trim() ?? "";
  const identity = machineId || (fallbackId ? `fallback:${fallbackId}` : "");
  const material = ["ironwallet-mcp", FINGERPRINT_VERSION, identity, parts.platform].join("|");
  const digest = createHash("sha256").update(material).digest("hex");
  return `${FINGERPRINT_VERSION}:${digest}`;
}

function readOsMachineId(platform: NodeJS.Platform = process.platform): string | undefined {
  try {
    if (platform === "linux") {
      for (const path of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
        try {
          const id = parseLinuxMachineId(readFileSync(path, "utf8"));
          if (id) return id;
        } catch {
          // try the next path
        }
      }
      return undefined;
    }

    if (platform === "win32") {
      const root = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
      const output = execFileSync(
        join(root, "System32", "reg.exe"),
        [
          "query",
          "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
          "/v",
          "MachineGuid",
          "/reg:64",
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
      );
      return parseWindowsMachineGuid(output);
    }

    if (platform === "darwin") {
      const output = execFileSync(
        "ioreg",
        ["-rd1", "-c", "IOPlatformExpertDevice"],
        { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
      );
      return parseMacPlatformUuid(output);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

let cached: string | undefined;

export function resolveDeviceFingerprint(fallbackId?: string): string {
  if (cached) return cached;
  cached = formatDeviceFingerprint({
    osMachineId: readOsMachineId(),
    platform: process.platform,
    fallbackId,
  });
  return cached;
}
