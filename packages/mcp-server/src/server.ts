/**
 * MCP stdio server. Launched by the MCP client (Cursor / Claude Desktop) per
 * the mcp.json entry. Keystore passphrase and relay API key are created on
 * first launch under ~/.ironwallet-mcp/ unless overridden by env.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/index.js";
import { getConfig, packageVersion } from "./config.js";
import { logStartupBanner } from "./log.js";

export async function serve(): Promise<void> {
  const cfg = getConfig();
  const server = new McpServer(
    {
      name: "ironwallet",
      version: packageVersion(),
    },
    {
      instructions: [
        "Local Ironwallet hot wallet. Keys never leave this machine. There is no extra confirmation UI. Prefer a dedicated wallet with limited balance.",
        "Never print, request, or invent recovery phrases or private keys. No tool accepts or returns a seed. Create/import/backup only via create_wallets backup_url or open_wallet_manager in the local browser.",
        "If there is no wallet yet, create_wallets or open_wallet_manager first.",
        "Transfer: list_wallets / get_balance → estimate_transfer (optional) → send_transfer. On timeout poll get_operation_status; do not resubmit blindly. send_transfer may reduce the amount so the fee fits.",
        "Swap: list_swap_networks → list_swap_assets (copy network/symbol/address/decimals from the catalog; do not invent token addresses; omit address only for native coins) → estimate_swap or execute_swap. Quotes expire. maxMode: true sells as much as the service allows. After execute, poll get_swap_status; if execute times out, poll before retrying.",
      ].join("\n"),
    },
  );

  registerTools(server);

  // Never write logs to stdout — that stream carries the JSON-RPC protocol.
  process.stderr.write(
    `[ironwallet-mcp] starting (relay=${cfg.relayUrl})\n`,
  );
  logStartupBanner({
    relayUrl: cfg.relayUrl,
    httpTimeoutMs: cfg.httpTimeoutMs,
    httpForwardTimeoutMs: cfg.httpForwardTimeoutMs,
    httpRetries: cfg.httpRetries,
    keystoreDir: cfg.keystoreDir,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
