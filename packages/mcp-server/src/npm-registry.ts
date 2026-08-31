/**
 * Resolve the npm registry used for @ironwallet/*, read packument dist-tags,
 * and stage updates into the npx cache. Used by get_runtime_info (read-only)
 * and prepare_update (writes only inside this package's own npx cache dir).
 * The running process is never restarted from here.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { httpJson } from "./api/http.js";

export const MCP_PACKAGE = "@ironwallet/mcp-server";
export const DEFAULT_NPM_REGISTRY = "https://registry.npmjs.org";

export type DistTags = Record<string, string>;

export type VersionStatus = "current" | "update_available" | "unknown";

export function resolveNpmRegistry(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const scoped =
    env["npm_config_@ironwallet:registry"] ??
    env["npm_config_@ironwallet_registry"];
  const raw = (scoped || env.npm_config_registry || DEFAULT_NPM_REGISTRY).trim();
  return raw.replace(/\/+$/, "") || DEFAULT_NPM_REGISTRY;
}

export function packumentUrl(
  registry: string,
  name: string = MCP_PACKAGE,
): string {
  const base = registry.replace(/\/+$/, "");
  return `${base}/${name.replace("/", "%2f")}`;
}

export function parseDistTags(json: unknown): DistTags {
  if (!json || typeof json !== "object") return {};
  const raw = (json as { "dist-tags"?: unknown })["dist-tags"];
  if (!raw || typeof raw !== "object") return {};
  const out: DistTags = {};
  for (const [tag, ver] of Object.entries(raw)) {
    if (typeof ver === "string" && ver.trim()) out[tag] = ver.trim();
  }
  return out;
}

export function versionStatus(
  running: string,
  latest: string | undefined,
): { status: VersionStatus; updateAvailable: boolean | null } {
  if (!latest) return { status: "unknown", updateAvailable: null };
  if (latest === running) return { status: "current", updateAvailable: false };
  return { status: "update_available", updateAvailable: true };
}

export function npxRefreshHint(platform: NodeJS.Platform = process.platform): string {
  const cache =
    platform === "win32"
      ? "%LOCALAPPDATA%\\npm-cache\\_npx"
      : "~/.npm/_npx";
  return (
    "This process does not self-update. Restart the MCP server to pick up a newer npm package. " +
    `If the version stays the same, delete ${cache} and restart.`
  );
}

export async function fetchDistTags(
  registry: string,
  opts: { correlationId?: string } = {},
): Promise<DistTags> {
  const url = packumentUrl(registry);
  const doc = await httpJson<unknown>(
    url,
    { headers: { Accept: "application/vnd.npm.install-v1+json, application/json" } },
    {
      timeoutMs: 8000,
      retries: 1,
      correlationId: opts.correlationId,
      label: "npm.packument",
    },
  );
  return parseDistTags(doc);
}

/** Directory containing this package's package.json (works from src/ and dist/). */
export function packageRootDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * If `packageRoot` lives inside an npx cache extract
 * (`…/_npx/<hash>/node_modules/@ironwallet/mcp-server`), return the
 * `…/_npx/<hash>` directory that the MCP host reuses on every start.
 * Returns null for global installs, local checkouts, and unpacked tarballs.
 */
export function npxCacheDirFor(packageRoot: string): string | null {
  const root = packageRoot.replace(/[\\/]+$/, "");
  const scopeDir = dirname(root);
  const nmDir = dirname(scopeDir);
  const hashDir = dirname(nmDir);
  const npxBase = dirname(hashDir);
  if (basename(root) !== "mcp-server") return null;
  if (basename(scopeDir) !== "@ironwallet") return null;
  if (basename(nmDir) !== "node_modules") return null;
  if (basename(npxBase) !== "_npx") return null;
  return hashDir;
}

/**
 * Path to npm-cli.js derived from npm_execpath (set by npm/npx when it
 * launched this process). Lets us run npm via `node npm-cli.js …` and avoid
 * the Windows `.cmd` / shell-quoting minefield. Null when unavailable.
 */
export function npmCliCandidate(env: NodeJS.ProcessEnv = process.env): string | null {
  const execPath = env.npm_execpath?.trim();
  if (!execPath) return null;
  const base = basename(execPath).toLowerCase();
  if (base === "npm-cli.js") return execPath;
  if (base === "npx-cli.js") return join(dirname(execPath), "npm-cli.js");
  return null;
}

export function buildInstallArgs(targetVersion: string): string[] {
  return [
    "install",
    `${MCP_PACKAGE}@${targetVersion}`,
    "--no-save",
    "--no-audit",
    "--no-fund",
    "--loglevel=error",
  ];
}

const SAFE_VERSION = /^[0-9A-Za-z.+-]+$/;

/**
 * Install `targetVersion` into the npx cache dir in place, so the next MCP
 * restart picks it up. The running process keeps executing the old code.
 * Throws with npm's stderr tail on failure; verifies the on-disk version.
 */
export async function stageUpdate(
  targetVersion: string,
  npxDir: string,
  opts: { timeoutMs?: number } = {},
): Promise<void> {
  if (!SAFE_VERSION.test(targetVersion)) {
    throw new Error(`Refusing to install suspicious version "${targetVersion}".`);
  }
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const args = buildInstallArgs(targetVersion);
  const npmCli = npmCliCandidate();
  const viaNode = npmCli !== null && existsSync(npmCli);

  await new Promise<void>((resolve, reject) => {
    // Prefer `node npm-cli.js` (no shell). Fall back to `npm` through the
    // platform shell; every token is fixed or SAFE_VERSION-checked above.
    const child = viaNode
      ? spawn(process.execPath, [npmCli, ...args], {
          cwd: npxDir,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        })
      : spawn(["npm", ...args].join(" "), {
          cwd: npxDir,
          stdio: ["ignore", "pipe", "pipe"],
          shell: true,
          windowsHide: true,
        });
    let stderrTail = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`npm install timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
    child.stderr?.on("data", (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000);
    });
    child.stdout?.resume();
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`npm install exited with code ${code}: ${stderrTail.trim()}`));
    });
  });

  const installedPkg = join(npxDir, "node_modules", "@ironwallet", "mcp-server", "package.json");
  let installed: string | undefined;
  try {
    installed = (JSON.parse(readFileSync(installedPkg, "utf8")) as { version?: string }).version;
  } catch {
    // fall through to the mismatch error below
  }
  if (installed !== targetVersion) {
    throw new Error(
      `Staged version mismatch: expected ${targetVersion}, found ${installed ?? "none"} in ${npxDir}.`,
    );
  }
}
