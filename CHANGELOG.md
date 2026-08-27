# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/ironwallet/ironwallet-agent-kit/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/ironwallet/ironwallet-agent-kit/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/ironwallet/ironwallet-agent-kit/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/ironwallet/ironwallet-agent-kit/releases/tag/v1.0.0
