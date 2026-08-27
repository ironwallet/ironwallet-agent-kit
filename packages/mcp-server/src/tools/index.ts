/**
 * MCP tool registrations. Design rule: the mnemonic never crosses the agent
 * boundary. Tools return addresses, balances, estimates, and tx hashes — never
 * seed words. There is intentionally no export_seed / import_wallet tool.
 * create_wallets is blocked until MCP consent is on file.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ok, session, withToolLog } from "./helpers.js";
import { registerWalletTools } from "./wallets.js";
import { registerTransferTools } from "./transfer.js";
import { registerSwapTools } from "./swap.js";

export function registerTools(server: McpServer): void {
  const helpers = { ok, withToolLog, session };
  registerWalletTools(server, helpers);
  registerTransferTools(server, helpers);
  registerSwapTools(server, helpers);
}
