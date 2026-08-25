# @ironwallet/mcp-server

Local [MCP](https://modelcontextprotocol.io) server for **Ironwallet** (`ironwallet-mcp` bin).

The Ironwallet MCP server gives AI agents secure access to a **non-custodial** wallet. Seed phrases stay encrypted on the host and never leave this machine — they never pass through the agent. Agents can retrieve balances, sign locally, transfer tokens, and swap across 10+ networks.

Seed-compatible with the [Ironwallet](https://ironwallet.io) app.

There is no per-transaction confirmation UI.

> **Hot-wallet only.** Use a dedicated wallet with limited balance. See [Security](#security).

Product page: [ironwallet.io/ai](https://ironwallet.io/ai)

**Requirements:** Node.js 20+ (`npx`).

---

## Install

```bash
npx -y @ironwallet/mcp-server
```

Or add to MCP config (Cursor: `.cursor/mcp.json` or global):

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

`npx` pulls the latest published build. First launch can take ~30s while dependencies install. If the MCP client times out, run the same command once in a terminal to warm the cache, then reconnect.

The plugin install on [ironwallet.io/ai](https://ironwallet.io/ai) wires this up automatically.

---

## How it works

```
MCP client  →  ironwallet-mcp (stdio)
                    ├── encrypted keystore on disk
                    ├── signs on this machine
                    └── HTTPS to Ironwallet backends
```

The mnemonic never appears in tool inputs/outputs, logs meant for the agent, or requests to backends / the LLM / the MCP client’s cloud.

---

## Features

| Area | Capability |
|------|------------|
| **Networks** | Ethereum, BSC, Polygon, Base, Arbitrum, Optimism, Avalanche, Tron, Bitcoin, Litecoin, Dogecoin, Solana, XRP, TON |
| **Wallets** | Create, import, list, deposit QR, and back up (local browser for secrets) |
| **Balances** | Native coins and tokens |
| **Transfers** | Fee estimate and send through Ironwallet’s transfer relay |
| **Swaps** | Quotes and execution through Ironwallet **Swap Proxy** |
| **Policy** | Optional per-wallet limits (`readOnly`, `maxPerTx`, transfer recipient allow-list). Applies to `send_transfer` and `execute_swap`. |

---

## Tools

| Tool | Purpose | Moves funds? |
|------|---------|:------------:|
| `list_wallets` | Names, addresses, and `policy` | no |
| `create_wallets` | New wallets; returns a browser `backup_url` | no |
| `open_wallet_manager` | Local browser UI to import / create / back up | no |
| `get_deposit_qr` | PNG QR (try chat; else local `qr_url`) | no |
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

### Wallets

- **Create:** `create_wallets` — the agent gets names and addresses; open `backup_url` in a browser to view and back up recovery phrases.
- **Import / back up:** `open_wallet_manager` — loopback-only page; the phrase is typed or shown only in the browser.
- **List:** `list_wallets`
- **Deposit QR:** `get_deposit_qr` — PNG (generated on the fly) plus `qr_url`. Show the image in chat when the host renders it; otherwise open `qr_url`. Pass `network` for one chain. The wallet manager also has a QR button next to each address.

The browser page binds to `127.0.0.1` under an unguessable path and shuts down after 15 minutes of inactivity.

### Transfers

1. `list_wallets` / `get_balance`
2. `estimate_transfer` (optional)
3. `send_transfer`
4. `get_operation_status` when you need to wait on the operation

`send_transfer` may reduce the amount slightly so the fee still fits the balance; the response reports when that happened.

### Swaps

Swaps use **Swap Proxy**, not the transfer relay.

1. `list_swap_networks`
2. `list_swap_assets` (`direction=from`, then `direction=to` with the chosen sell asset)
3. Copy **network, symbol, address, decimals** from the catalog into `estimate_swap` / `execute_swap` (especially for tokens)
4. `estimate_swap` for a preview, or go straight to `execute_swap`
5. Poll with `get_swap_status` using `operationId`

**Useful options**

- `maxMode: true` — sell as much of the balance as the service allows (fees are accounted for server-side). `amount` can be omitted when `maxMode` is set.
- Omit `address` only for native coins. For tokens, always pass `address` (and ideally `decimals`) from `list_swap_assets`.

**Operational notes**

- Quotes expire. Prefer `execute_swap` (fresh quote). If execute times out, **poll status** before retrying — do not blindly re-run execute.
- Wallet policy: `readOnly` blocks sends and swaps. `maxPerTx` applies to the transfer amount or the corrected swap sell amount. A transfer recipient allow-list also blocks swaps (the swap router is not a whitelisted destination).

---

## Configuration

Nothing to paste into MCP config for normal use. On first launch the server writes a relay API key, keystore wrapping secret, and device id under `~/.ironwallet-mcp/` (`keystore-passphrase`, `relay-api-key`, `device-id`, mode `0600`). Set the env vars only to override.

The user-facing backup is the **recovery phrase** in the wallet manager, not those files.

| Variable | Default | Notes |
|----------|---------|-------|
| `IW_PASSPHRASE` | generated locally | Override keystore wrapping secret |
| `IW_READ_ONLY` | `false` | Process-wide: reject `send_transfer` and `execute_swap`. `true`/`1` enable; `false`/`0`/`off`/`no` disable. Distinct from per-wallet `policy.readOnly`. |
| `IW_RELAY_API_KEY` | generated UUID | Override `x-api-key` |
| `IW_DEVICE_ID` | generated UUID | Override `X-Device-Id` (stable per keystore directory) |
| `IW_KEYSTORE_DIR` | `~/.ironwallet-mcp` | Keystore directory |
| `IW_HTTP_TIMEOUT_MS` | `15000` | General HTTP timeout (1s–120s) |
| `IW_HTTP_FORWARD_TIMEOUT_MS` | `60000` | Longer timeout for broadcast-style calls. A client timeout does not always mean the operation failed — check status |
| `IW_HTTP_RETRIES` | `2` | Retries for safe/idempotent calls; broadcasts are not auto-retried |
| `IW_LOG_ENABLED` | `1` | JSONL diagnostics to a log file (`0` to disable) |
| `IW_LOG_FILE` | `{keystoreDir}/logs/iw-mcp-YYYY-MM-DD.jsonl` | Log path |
| `IW_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `IW_LOG_STDERR` | `0` | Mirror logs to stderr (stdout is reserved for MCP) |

---

## Security

- Seeds are encrypted at rest. They never appear in tool results, agent chat, or backend requests.
- The agent **can move funds without asking again**. Optional wallet policy (`readOnly`, `maxPerTx`, transfer recipient allow-list) is off by default and applies to both `send_transfer` and `execute_swap`.
- Anyone with the keystore **and** the wrapping secret controls the funds. A leaked seed cannot be revoked.
- Timeout is not always failure: poll status before retrying a send or swap.
- Desktop / stdio only. A phone or remote agent would need a design where signing stays on a trusted device.
- **Do not** put a main wallet here. Use a small hot wallet.

Details and private disclosure: [SECURITY.md](../../SECURITY.md).

## License

[MIT](LICENSE)
