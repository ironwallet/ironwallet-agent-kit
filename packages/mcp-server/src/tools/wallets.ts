/**
 * MCP tools for local keystore wallet management.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createWallets, loadKeystore, resolveEntry } from "../keystore/store.js";
import { requirePassphrase } from "../passphrase.js";
import {
  depositPayload,
  depositQrUrl,
  renderDepositQrPng,
  selectDepositTargets,
} from "../qr/deposit-qr.js";
import { ensureManager } from "../web/manager.js";
import { listWalletPolicy } from "../policy.js";
import { logInfo, logWarn } from "../log.js";
import { mcpToolConfig, toolDefinition } from "./definitions.js";
import type { ToolHelpers } from "./helpers.js";

export function registerWalletTools(server: McpServer, helpers: ToolHelpers): void {
  const { ok, withToolLog } = helpers;

  server.registerTool(
    "list_wallets",
    mcpToolConfig(toolDefinition("list_wallets")),
    async () =>
      withToolLog("list_wallets", {}, async ({ correlationId }) => {
        const ks = loadKeystore();
        const wallets = ks.wallets.map((w) => ({
          name: w.name,
          addresses: w.addresses,
          backedUp: w.backedUp,
          policy: listWalletPolicy(w.policy),
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
    mcpToolConfig(toolDefinition("create_wallets")),
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
    mcpToolConfig(toolDefinition("open_wallet_manager")),
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

  server.registerTool(
    "get_deposit_qr",
    mcpToolConfig(toolDefinition("get_deposit_qr")),
    async ({ wallet, network }) =>
      withToolLog("get_deposit_qr", { wallet, network }, async ({ correlationId }) => {
        const entry = resolveEntry(wallet);
        const targets = selectDepositTargets(entry.addresses, network);
        let managerUrl: string | undefined;
        try {
          managerUrl = await ensureManager();
        } catch (e) {
          logWarn("tool.get_deposit_qr.manager_unavailable", {
            correlationId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        const qrs = [];
        for (const t of targets) {
          const payload = depositPayload(t.network, t.address);
          const png = await renderDepositQrPng(t.address, payload);
          qrs.push({
            network: t.network,
            address: t.address,
            payload,
            png,
            qr_url: managerUrl ? depositQrUrl(managerUrl, t.network, t.address) : undefined,
          });
        }
        logInfo("tool.get_deposit_qr.result", {
          correlationId,
          wallet: entry.name,
          networks: qrs.map((q) => q.network),
        });
        return ok(
          {
            correlationId,
            wallet: entry.name,
            qrs: qrs.map(({ network: n, address, payload, qr_url }) => ({
              network: n,
              address,
              payload,
              qr_url,
            })),
            note: managerUrl
              ? "Show the PNG in chat if the host renders it. If the user cannot see the QR, open qr_url (local-only, 15 minutes) and give the address."
              : "Show the PNG in chat if the host renders it. If the user cannot see the QR, call open_wallet_manager and use the QR button next to the address.",
          },
          qrs.map((q) => ({
            type: "image" as const,
            data: q.png.toString("base64"),
            mimeType: "image/png" as const,
          })),
        );
      }),
  );
}
