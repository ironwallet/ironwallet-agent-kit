# CLAUDE.md

This repository is the IronWallet agent kit. The MCP server (`@ironwallet/mcp-server`) gives agents a **non-custodial** hot wallet on this machine. Seed phrases stay encrypted on the host and never leave it. There is no per-transaction confirmation UI.

Opening this folder should start the wallet MCP via [`.mcp.json`](.mcp.json) (`npx -y @ironwallet/mcp-server`). Needs **Node.js 20+**.

## What lives here

- `packages/mcp-server` — stdio MCP: balances, transfers, swaps, deposit QR
- `skills/ironwallet-mcp/SKILL.md` — how to operate the wallet
- `providers/*/plugin/` — Cursor, Claude, Codex, and Grok plugins
- Machine-readable docs index: [`llms.txt`](llms.txt)

Product page: https://ironwallet.io/ai

## Safety

- Never print, request, or invent recovery phrases or private keys.
- Create / import / backup only via `create_wallets` (`backup_url`) or `open_wallet_manager` in the local browser.
- Chat intent authorizes send and swap (irreversible once broadcast). Prefer a dedicated hot wallet with limited balance.
- Read `list_wallets.policy` before sending. `{ enabled: false }` means no extra limits. `IW_READ_ONLY=true` blocks send and swap for the whole server.
- Timeout is not failure: poll `get_operation_status` / `get_swap_status`. Do not resubmit blindly.

## How to operate

- **Transfer:** `list_wallets` / `get_balance` → `estimate_transfer` (optional) → `send_transfer`
- **Swap:** `list_swap_networks` → `list_swap_assets`. Copy `network`, `symbol`, `address`, `decimals` from the catalog. Do not invent token addresses. Then `estimate_swap` or `execute_swap`.
- **Deposit QR:** `get_deposit_qr`. Show the PNG in chat if the host renders it. If the user cannot see it, open `qr_url` and write the address. Do not say the QR is “above” unless they can see it.

Networks: Ethereum, BSC, Polygon, Base, Arbitrum, Optimism, Avalanche, Tron, Bitcoin, Litecoin, Dogecoin, Solana, XRP, TON.

There is no generic smart-contract call tool. Transfers and swaps are the on-chain actions.

## Security

See [SECURITY.md](SECURITY.md). Do not put a main or savings wallet here.
