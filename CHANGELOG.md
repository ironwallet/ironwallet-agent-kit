# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.1.1]: https://github.com/ironwallet/ironwallet-agent-kit/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/ironwallet/ironwallet-agent-kit/compare/v1.0.3...v1.1.0
[1.0.3]: https://github.com/ironwallet/ironwallet-agent-kit/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/ironwallet/ironwallet-agent-kit/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/ironwallet/ironwallet-agent-kit/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/ironwallet/ironwallet-agent-kit/releases/tag/v1.0.0
