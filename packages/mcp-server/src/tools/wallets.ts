/**
 * MCP tools for local keystore wallet management.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createWallets, loadKeystore } from "../keystore/store.js";
import { requirePassphrase } from "../passphrase.js";
import { ensureManager } from "../web/manager.js";
import { logInfo, logWarn } from "../log.js";
import type { ToolHelpers } from "./helpers.js";

export function registerWalletTools(server: McpServer, helpers: ToolHelpers): void {
  const { ok, withToolLog } = helpers;

  server.registerTool(
    "list_wallets",
    {
      title: "List wallets",
      description:
        "List the wallets in the local keystore with their addresses per network. Never returns private keys or seed phrases.",
      inputSchema: {},
    },
    async () =>
      withToolLog("list_wallets", {}, async ({ correlationId }) => {
        const ks = loadKeystore();
        const wallets = ks.wallets.map((w) => ({
          name: w.name,
          addresses: w.addresses,
          backedUp: w.backedUp,
          policy: w.policy?.enabled ? w.policy : undefined,
        }));
        logInfo("tool.list_wallets.result", {
          correlationId,
          count: wallets.length,
          names: wallets.map((w) => w.name),
        });
        // Keep the historical array shape for agents; correlationId is in the log.
        return ok(wallets);
      }),
  );

  server.registerTool(
    "create_wallets",
    {
      title: "Create wallets",
      description:
        "Generate one or more brand-new wallets (BIP-39). Returns names and addresses only. Seed phrases are NOT returned to the agent. The response includes a local browser URL where the user can view and back up the recovery phrases.",
      inputSchema: {
        count: z.number().int().min(1).max(50).describe("How many wallets to create."),
        name_prefix: z
          .string()
          .optional()
          .describe("Optional name prefix, e.g. 'agent-hot'. Defaults to 'wallet'."),
      },
    },
    async ({ count, name_prefix }) =>
      withToolLog("create_wallets", { count, name_prefix }, async ({ correlationId }) => {
        const created = createWallets(count, requirePassphrase(), {
          namePrefix: name_prefix,
        });
        let backupUrl: string | undefined;
        try {
          backupUrl = await ensureManager();
        } catch (e) {
          logWarn("tool.create_wallets.manager_unavailable", {
            correlationId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return ok({
          correlationId,
          created: created.map((c) => ({ name: c.name, addresses: c.addresses })),
          backup_url: backupUrl,
          backup_hint: backupUrl
            ? "Seed phrases were not shown to the agent. To view and back them up, open backup_url in a browser and click \"Reveal / backup\" for each wallet (words stay in the browser)."
            : "Seed phrases were not shown to the agent. Call open_wallet_manager and back up each wallet in the browser (Reveal / backup).",
        });
      }),
  );

  server.registerTool(
    "open_wallet_manager",
    {
      title: "Open wallet manager (browser)",
      description:
        "Open a local browser form to add/import/create wallets or back them up (reveal the recovery phrase). Returns a localhost URL for the user to open. Seed phrases are entered and shown ONLY in the browser and never pass through the agent. Use this whenever the user asks to add, import, create, or back up a wallet.",
      inputSchema: {},
    },
    async () =>
      withToolLog("open_wallet_manager", {}, async ({ correlationId }) => {
        const url = await ensureManager();
        return ok({
          correlationId,
          url,
          note:
            "Open this URL in your browser to import/create/backup wallets. " +
            "The recovery phrase stays in the browser and is never sent to the agent. " +
            "The page is local-only (127.0.0.1) and closes itself after 15 minutes of inactivity.",
        });
      }),
  );
}
