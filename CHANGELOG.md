# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-09-30

### Added

- New wallet manager (React app served by `open_wallet_manager`) with light and dark themes: wallets list, create, import, rename and two-step delete; backup with a recovery phrase order check; portfolio with balances, 24h change, token list and visibility toggles; receive QR; transaction history across networks with filters and a transaction detail page.
- History kind `blockscout` for Blockscout REST v2 (`…/api/v2`). Blockscout URLs listed under kind `etherscan` are read through v2 as well.

### Changed

- `create_wallets`: `backup_url` opens the Backup page of the new manager.
- Token visibility and sorting are manager preferences only; `list_wallets` and `get_balance` still return every token.
- Keyless TronScan and TronGrid requests are paced to stay under their rate limits; TronGrid retries a stalled request once.
- Each history page is fetched once per `get_transaction_history` call.
- Tron transaction links point to tronscanner.org.

### Removed

- The legacy HTML wallet manager pages. `/qr` for `get_deposit_qr` stays.

## [1.2.1] - 2026-09-08

### Added

- TON history: `tonapi.io` fallback after TonCenter; TonCenter rate limits are retried.

### Changed

- `get_deposit_qr`: network name on the PNG.
- `set_wallet_policy`: response warns when the new policy is weaker than the previous one.
- Vulnerable transitive dependencies bumped; `npm audit` is clean.

### Removed

- `operationId` from `estimate_swap` — a quote cannot be polled with `get_swap_status`.

### Fixed

- Transfer and swap tools reject zero and negative amounts.

## [1.2.0] - 2026-09-02

### Added

- `get_transaction_history` tool: recent transactions of a wallet on one network, newest first, paged via `cursor`. Read from public explorers with per-network fallback, not from the IronWallet backend. Spam-looking token symbols carry an `asset.warning`.
- Server instructions cover the wallet manager and the update flow.
- Wallet manager: Delete button per wallet. A separate confirmation page requires retyping the wallet name; a wallet that was never backed up also needs an explicit acknowledgement that its recovery phrase is destroyed. Manager only — there is no MCP tool for deleting.

### Changed

- Keystore writes are atomic (temp file + rename), so a crash mid-write cannot truncate `keystore.json`.

### Fixed

- `estimate_swap` / `execute_swap`: `to` was published as a `$ref` to `from`; hosts that do not resolve `$ref` (Claude chat) rejected every swap. Both sides now have inline schemas.
- Wallet manager: Continue on the disclaimer redirects to the dashboard, so Refresh shows the current wallet list instead of a stale page or 404.

## [1.1.1] - 2026-08-31

### Added

- `get_runtime_info` tool: running `@ironwallet/mcp-server` version vs published npm dist-tags. Does not self-update.
- `prepare_update` tool: on explicit user request, stage the published version into the npx cache so the next MCP restart runs it. No self-restart; wallets untouched.

### Changed

- MCP Registry metadata (`server.json`): capability-focused description, icon, `runtimeHint: npx`, and the `IW_READ_ONLY` environment variable. Release CI stamps build provenance into publisher-provided `_meta`.

## [1.1.0] - 2026-08-28

### Changed

- MCP backend traffic uses the production URL (`https://iwio.ai`).

## [1.0.3] - 2026-08-27

### Added

- MCP consent before create/import: full English disclaimer in chat (`accept_mcp_consent`) or the local wallet manager.
- `set_wallet_policy` tool: per-wallet limits from chat (`readOnly`, `maxPerTxUsd`, transfer recipient allow-list; full replace).
- USD per-transaction limit (`maxPerTxUsd`): send/swap amounts are valued via the IronWallet rates backend at operation time and rejected when no rate is available (fail closed). Replaces the never-exposed asset-unit `maxPerTx`.

### Changed

- Consent copy: limits are described as chat-configurable (`set_wallet_policy`), not as a pre-use setup step in the wallet manager.

## [1.0.2] - 2026-08-26

### Added

- Register as `io.ironwallet/mcp-server` (`mcpName` + `server.json`) for the MCP registry.
- Export MCP tool schemas to `tools.json` so README and skill tables stay in sync.

### Changed

- npm keywords include supported networks. User-facing copy no longer names the internal swap service.
- Brand spelling: IronWallet.

## [1.0.1] - 2026-08-25

### Added

- Deposit QR (`get_deposit_qr`): PNG in chat when the host can render it, otherwise a local `qr_url`.

### Changed

- Plugin id is `ironwallet-mcp` on Cursor, Claude, Codex, and Grok.

### Security

- `IW_READ_ONLY` rejects `send_transfer` and `execute_swap` for the whole process.

## [1.0.0] - 2026-08-20

### Added

- Release of the IronWallet agent kit and `@ironwallet/mcp-server`.

[1.3.0]: https://github.com/ironwallet/ironwallet-agent-kit/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/ironwallet/ironwallet-agent-kit/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/ironwallet/ironwallet-agent-kit/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/ironwallet/ironwallet-agent-kit/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/ironwallet/ironwallet-agent-kit/compare/v1.0.3...v1.1.0
[1.0.3]: https://github.com/ironwallet/ironwallet-agent-kit/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/ironwallet/ironwallet-agent-kit/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/ironwallet/ironwallet-agent-kit/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/ironwallet/ironwallet-agent-kit/releases/tag/v1.0.0
