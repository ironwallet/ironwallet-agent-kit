# Changelog

Notable changes to the Ironwallet agent kit. Tag each entry:

- **content** — skills, rules, agents, assets
- **plugin** — Cursor and/or Claude Code plugin packaging
- **npm** — `@ironwallet/mcp-server`

The public GitHub history is release snapshots. Internal development history is not mirrored here. Production releases should record the configuration commit baked into that build when it is known.

## Unreleased

## 0.7.0

First public snapshot of the agent kit.

### content

- Skill `ironwallet-mcp` (balances, transfers, Swap Proxy swaps, create / import / backup)
- Rules: `wallet-transaction-safety`, `seed-phrase-handling`, `swap-asset-resolution`
- Agent `ironwallet-operator`

### plugin

- Cursor and Claude Code plugins `ironwallet` 0.7.0

### npm

- `@ironwallet/mcp-server` 0.7.0: local stdio MCP for balances, transfers, and Swap Proxy swaps. Seeds stay encrypted on the machine
