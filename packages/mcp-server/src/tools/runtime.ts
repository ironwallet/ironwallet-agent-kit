/**
 * Runtime / version tools. get_runtime_info is read-only; prepare_update
 * writes only inside this package's own npx cache dir and never restarts
 * the running server. Neither touches the keystore.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { packageVersion } from "../config.js";
import { logInfo } from "../log.js";
import {
  MCP_PACKAGE,
  fetchDistTags,
  npxCacheDirFor,
  npxRefreshHint,
  packageRootDir,
  resolveNpmRegistry,
  stageUpdate,
  versionStatus,
} from "../npm-registry.js";
import { mcpToolConfig, toolDefinition } from "./definitions.js";
import type { ToolHelpers } from "./helpers.js";

/**
 * Captured at startup: prepare_update rewrites this package's files on disk,
 * so a later packageVersion() read would report the staged version instead of
 * the code that is actually running.
 */
const RUNNING_VERSION = packageVersion();

export function registerRuntimeTools(server: McpServer, helpers: ToolHelpers): void {
  const { ok, withToolLog } = helpers;

  server.registerTool(
    "get_runtime_info",
    mcpToolConfig(toolDefinition("get_runtime_info")),
    async () =>
      withToolLog("get_runtime_info", {}, async ({ correlationId }) => {
        const running = RUNNING_VERSION;
        const registry = resolveNpmRegistry();
        const hint = npxRefreshHint();
        let distTags: Record<string, string> = {};
        let registryError: string | undefined;
        try {
          distTags = await fetchDistTags(registry, { correlationId });
        } catch (e) {
          registryError = e instanceof Error ? e.message : String(e);
        }
        const latest = distTags.latest;
        const { status, updateAvailable } = versionStatus(running, latest);
        const payload = {
          correlationId,
          package: MCP_PACKAGE,
          running,
          registry,
          latest: latest ?? null,
          distTags,
          updateAvailable,
          status,
          hint,
          ...(registryError ? { registryError } : {}),
        };
        logInfo("tool.get_runtime_info.result", {
          correlationId,
          running,
          latest: latest ?? null,
          status,
          registry,
        });
        return ok(payload);
      }),
  );

  server.registerTool(
    "prepare_update",
    mcpToolConfig(toolDefinition("prepare_update")),
    async ({ tag }) =>
      withToolLog("prepare_update", { tag }, async ({ correlationId }) => {
        const requestedTag = (tag ?? "latest").trim();
        if (!/^[A-Za-z0-9._-]+$/.test(requestedTag)) {
          throw new Error(`Invalid dist-tag "${requestedTag}".`);
        }
        const registry = resolveNpmRegistry();
        const distTags = await fetchDistTags(registry, { correlationId });
        const targetVersion = distTags[requestedTag];
        if (!targetVersion) {
          throw new Error(
            `Dist-tag "${requestedTag}" not found on ${registry}. Available: ${
              Object.keys(distTags).join(", ") || "none"
            }.`,
          );
        }
        if (targetVersion === RUNNING_VERSION) {
          return ok({
            correlationId,
            package: MCP_PACKAGE,
            status: "current",
            running: RUNNING_VERSION,
            target: targetVersion,
            tag: requestedTag,
            registry,
            note: "Already on this version. Nothing was staged.",
          });
        }
        const npxDir = npxCacheDirFor(packageRootDir());
        if (!npxDir) {
          return ok({
            correlationId,
            package: MCP_PACKAGE,
            status: "unsupported",
            running: RUNNING_VERSION,
            target: targetVersion,
            packageRoot: packageRootDir(),
            note:
              "This server is not running from the npx cache (global or local install). Update it the same way it was installed, then restart the MCP host.",
          });
        }
        await stageUpdate(targetVersion, npxDir);
        logInfo("tool.prepare_update.staged", {
          correlationId,
          running: RUNNING_VERSION,
          staged: targetVersion,
          tag: requestedTag,
          registry,
          npxDir,
        });
        return ok({
          correlationId,
          package: MCP_PACKAGE,
          status: "prepared",
          running: RUNNING_VERSION,
          prepared: targetVersion,
          tag: requestedTag,
          registry,
          appliedOn: "next MCP restart",
          hint:
            "The new version is staged in the npx cache. Ask the user to restart the MCP host (reload the editor or start a new session); this process keeps running the old version until then.",
        });
      }),
  );
}
