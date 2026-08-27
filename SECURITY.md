# Security Policy

This repository is the **IronWallet agent kit and MCP server** (`@ironwallet/mcp-server`) in production configuration. It is **not** the IronWallet mobile or desktop app. Those remain closed-source.

Product terms and privacy live on the website, not here:

- [Terms and conditions](https://ironwallet.io/terms-and-conditions/)
- [Privacy policy](https://ironwallet.io/privacy-policy/)

## Reporting a vulnerability

**Do not open a public GitHub issue, pull request, or discussion for security issues.** That publishes the problem to everyone, including people who would exploit it.

Report privately using **one** of:

1. **GitHub Security Advisories** (preferred): [Open a private advisory](https://github.com/ironwallet/ironwallet-agent-kit/security/advisories/new)
2. **Email** the Security group: [security@ironwallet.io](mailto:security@ironwallet.io)

In the report, include:

- Affected component (`packages/mcp-server`, a plugin, a skill/rule, or the local wallet manager)
- Version (`@ironwallet/mcp-server` version and/or plugin version)
- Steps to reproduce, impact, and any proof-of-concept **without** real seed phrases, private keys, or main-wallet funds

We aim to **acknowledge** a valid report within **3 business days**. We will say whether the issue is in this kit, in the closed-source app, or in the backends, and we will keep the reporter informed until it is fixed or declined.

There is no public bug bounty for this repository.

## Scope

**In scope (this repository)**

- Local MCP server: keystore encryption, signing, tool handlers, wallet-manager loopback page
- Cursor, Claude Code, Codex, and Grok plugins, skills, rules, and the operator agent
- Secrets written under `~/.ironwallet-mcp/` (wrapping secret, relay API key, device id, logs)

**Out of scope (still report privately; they are not fixed in this tree)**

- IronWallet iOS / Android / desktop application
- IronWallet backends
- Third-party RPC / indexer / blockchain behavior
- Issues that only exist in non-production builds you do not have from this public tree

## Threat model

The MCP server is a **self-custody hot wallet** on the user’s machine. Recovery phrases are encrypted at rest in `~/.ironwallet-mcp/keystore.json` and unwrapped with a local secret (`keystore-passphrase`, or `IW_PASSPHRASE` if set). The server decrypts locally in order to sign. The mnemonic and private keys never appear in MCP tool arguments or results, in agent chat, in logs intended for the model, or in HTTPS bodies to IronWallet backends.

What **does** leave the machine: signed transactions and swap payloads, plus non-secret metadata (wallet names/addresses, balances, quotes, a device id). The generated relay API key is sent to IronWallet backends as `x-api-key`; it is an authentication credential, stored with the other secrets under `~/.ironwallet-mcp/`. Signing never happens on IronWallet servers. There is **no** per-transaction confirmation UI. Optional per-wallet policy (`readOnly`, `maxPerTxUsd`, transfer recipient allow-list — set via the `set_wallet_policy` tool; USD limits are valued through IronWallet backend rates and fail closed when no rate is available) is off by default. Process-wide `IW_READ_ONLY` rejects `send_transfer` and `execute_swap` before that policy.

Anyone with both the keystore file **and** the wrapping secret can move funds. A leaked seed cannot be revoked. Treat this as a dedicated hot wallet with a balance you can afford to lose. Timeout is not always failure: poll `get_operation_status` / `get_swap_status` before retrying a send or swap.

## Safe use

- Use a **dedicated** wallet with a limited balance. Do not import a primary savings wallet.
- Back up the recovery phrase only in the local wallet manager (`open_wallet_manager` / `backup_url`), never in chat, tickets, or git.
- Keep `~/.ironwallet-mcp/` private (owner-only POSIX mode `0600`, or NTFS ACL on Windows). Backing up those files is **not** a substitute for the recovery phrase.
- Desktop / stdio only. Do not expose the MCP server on a network socket.

## License and copyleft

Source in this repository is [MIT](LICENSE). Cursor Marketplace requires a permissive license; GPL, AGPL, and LGPL must not appear in this tree or in the published npm package’s dependency closure.
