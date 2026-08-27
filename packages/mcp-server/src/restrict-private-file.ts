/**
 * Owner-only access for files under ~/.ironwallet-mcp/.
 * POSIX: chmod 0600. Windows: NTFS ACL via icacls (chmod is a no-op there).
 * Best-effort: a failed chmod/icacls must not block keystore or secret writes.
 */

import { execFileSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";

export function windowsIcaclsPath(
  systemRoot: string | undefined = process.env.SystemRoot || process.env.WINDIR,
): string {
  return join(systemRoot || "C:\\Windows", "System32", "icacls.exe");
}

export function windowsIcaclsArgs(filePath: string, username: string): string[] {
  return [filePath, "/inheritance:r", "/grant:r", `${username}:F`];
}

export function resolveWindowsUsername(
  osUsername: string | undefined = safeOsUsername(),
  envUsername: string | undefined = process.env.USERNAME,
): string {
  const fromOs = osUsername?.trim();
  if (fromOs) return fromOs;
  return envUsername?.trim() ?? "";
}

function safeOsUsername(): string | undefined {
  try {
    return userInfo().username;
  } catch {
    return undefined;
  }
}

export function restrictPrivateFile(filePath: string): void {
  if (process.platform === "win32") {
    try {
      const username = resolveWindowsUsername();
      if (!username) return;
      execFileSync(windowsIcaclsPath(), windowsIcaclsArgs(filePath, username), {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      // missing icacls, AppLocker, Controlled Folder Access, bad account name
    }
    return;
  }

  try {
    chmodSync(filePath, 0o600);
  } catch {
    // best effort on filesystems without POSIX perms
  }
}
