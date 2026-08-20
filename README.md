# Ironwallet for AI agents

Local Ironwallet MCP: balances, transfers, and Swap Proxy swaps. Seeds stay encrypted on the machine.

Give an agent a **self-custody hot wallet** on your computer, seed-compatible with the [Ironwallet](https://ironwallet.io) app. Signing never leaves this machine. There is no per-transaction confirmation UI.

This repository is the **agent kit and MCP server**. The Ironwallet mobile/desktop app stays closed-source.

**Requirements:** Node.js 20+ (`npx`). Use a dedicated wallet with limited balance.

Product page: [ironwallet.io/ai](https://ironwallet.io/ai)

## Install

**Cursor:** [ironwallet.io/ai](https://ironwallet.io/ai)

**Claude Code:**

```bash
claude plugin marketplace add Ironwallet/ironwallet-agent-kit
claude plugin install ironwallet@ironwallet
```

Reload so MCP picks up `PATH`. From a local clone, use `.` instead of the GitHub repo.

### MCP only (no plugin)

Manually installed MCP does **not** auto-update with the plugin.

```json
{
  "mcpServers": {
    "ironwallet": {
      "command": "npx",
      "args": ["-y", "@ironwallet/mcp-server"]
    }
  }
}
```

## What's included

### Skill

| Skill | When to use |
|-------|-------------|
| **ironwallet-mcp** | Balances, transfers, Swap Proxy swaps, create / import / backup. Invoke as `/ironwallet-mcp` |

### Rules

| Rule | What it enforces |
|------|------------------|
| **wallet-transaction-safety** | Hot wallet; no extra confirmation UI; poll status on timeout, never resubmit blindly |
| **seed-phrase-handling** | Recovery phrases and private keys never appear in chat, files, or logs |
| **swap-asset-resolution** | Networks and tokens come from catalog tools, not model memory |

### Agent

| Agent | Purpose |
|-------|---------|
| **ironwallet-operator** | Operate the local wallet: balances, estimates, sends, swaps, status |

### MCP server

`@ironwallet/mcp-server` over stdio. Networks: Ethereum, BSC, Polygon, Base, Arbitrum, Optimism, Avalanche, Tron, Bitcoin, Litecoin, Dogecoin, Solana, XRP, TON.

## Tools

| Tool | Purpose | Moves funds? |
|------|---------|:------------:|
| `list_wallets` | Names and addresses | no |
| `create_wallets` | New wallets; returns a browser `backup_url` | no |
| `open_wallet_manager` | Local browser UI to import / create / back up | no |
| `get_balance` | Native or token balance | no |
| `estimate_transfer` | Fee estimate, no broadcast | no |
| `send_transfer` | Sign locally and send | **yes** |
| `get_operation_status` | Poll a transfer | no |
| `list_swap_networks` | Networks available for swap | no |
| `list_swap_assets` | Sell / buy catalog | no |
| `estimate_swap` | Quote (may expire) | no |
| `execute_swap` | Fresh quote → sign → swap | **yes** |
| `get_swap_status` | Poll a swap | no |

No tool accepts or returns a seed. Import and backup only in the local browser (`open_wallet_manager` / `backup_url`).

## Configuration

Nothing to paste into MCP config for normal use. On first launch the server writes a relay API key, keystore wrapping secret, and device id under `~/.ironwallet-mcp/` (mode `0600`). Override with `IW_RELAY_API_KEY` / `IW_PASSPHRASE` / `IW_DEVICE_ID` only if you must.

The user-facing backup is the **recovery phrase** in the wallet manager, not those files.

## Security

- Seeds are encrypted at rest. They never appear in tool results, agent chat, or backend requests.
- The agent **can move funds without asking again**. Optional wallet policy (`readOnly`, `maxPerTx`, transfer recipient allow-list) is off by default and applies to both sends and swaps.
- Anyone with the keystore **and** the wrapping secret controls the funds. A leaked seed cannot be revoked.
- Timeout is not always failure: poll status before retrying a send or swap.
- **Do not** put a main wallet here. Use a small hot wallet.

Details and private disclosure: [SECURITY.md](SECURITY.md).

## Contributing

This public tree is a release snapshot. See [CONTRIBUTING.md](CONTRIBUTING.md). Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
