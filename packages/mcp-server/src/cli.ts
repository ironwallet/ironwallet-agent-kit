#!/usr/bin/env node
/**
 * Public binary. Starts the stdio MCP server. Wallet create / import / backup
 * is the local browser manager (`open_wallet_manager`), not this CLI.
 */

import { serve } from "./server.js";

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd && cmd !== "serve") {
    process.stderr.write(
      "ironwallet-mcp starts the MCP stdio server.\n" +
        "Create, import, and back up wallets in the local browser (open_wallet_manager).\n",
    );
    process.exit(1);
  }
  await serve();
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
