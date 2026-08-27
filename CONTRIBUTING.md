# Contributing

Thanks for taking the time. This GitHub tree is a **production snapshot**: IronWallet develops the kit internally and exports a finished whitelist for each public release. Skills, rules, agents, and logos are already copied into the plugin directories. There is no content generator here. The commit history is those release cuts, not day-to-day development.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## How changes land

Merging a pull request into public `main` would fork this tree away from the source of truth. **Do not expect a GitHub PR to be merged here.**

1. Open a GitHub **issue** (bug or feature). A draft PR is fine for showing a patch, but it will not be merged on GitHub.
2. Maintainers port accepted work internally and regenerate plugin copies on the next export.
3. The change appears here (and in npm / plugin versions when we cut a release).

We will reply on the issue. If you hear nothing for a long time, that is a process failure — ping the issue, do not merge on GitHub yourself.

Security issues: **[SECURITY.md](SECURITY.md)** — never a public issue.

## Local setup

**Node.js 20+.** The published server is enough for normal use:

```bash
npx -y @ironwallet/mcp-server
```

From a clone, you can also build the MCP package:

```bash
cd packages/mcp-server
npm ci
npm run build
node dist/cli.js
```

Plugin files under `providers/*/plugin/` and root `skills/` are already filled in. Do not hand-edit generated `skills/`, `rules/`, `agents/`, or `assets/` copies — open an issue instead.

Hand-edited on purpose:

- `providers/<harness>/plugin/.<harness>-plugin/plugin.json`
- harness MCP config (`mcp.json` / `.mcp.json`)
- `providers/<harness>/plugin/README.md`

## Pull request checklist (discussion patches)

- [ ] New or changed MCP tools: update `packages/mcp-server/src/tools/definitions.ts` (do not hand-edit the README / skill tool tables)
- [ ] MCP changes: `packages/mcp-server` builds (`npm ci && npm run build`)
- [ ] [`CHANGELOG.md`](CHANGELOG.md) lists the change under the version in this release commit (Added / Changed / Deprecated / Removed / Fixed / Security). **[Unreleased]** stays empty.
- [ ] No recovery phrases, private keys, or real main-wallet addresses in fixtures, logs, or docs
- [ ] No secrets in `mcp.json` — leave generation to first launch under `~/.ironwallet-mcp/`

## Versioning

Plugin manifests and `@ironwallet/mcp-server` share the same `x.y.z`. Bump them together when cutting a release:

- `packages/mcp-server/package.json` (and its lockfile)
- `.cursor-plugin/marketplace.json`
- `.claude-plugin/marketplace.json`
- `.agents/plugins/marketplace.json`
- `.grok-plugin/marketplace.json`
- `providers/cursor/plugin/.cursor-plugin/plugin.json`
- `providers/claude/plugin/.claude-plugin/plugin.json`
- `providers/codex/plugin/.codex-plugin/plugin.json`
- `providers/grok/plugin/.grok-plugin/plugin.json`

Write the notes under that version in the same commit. Leave **[Unreleased]** empty. Skill-only wording fixes can wait for the next version bump; do not bump semver on every copy-edit.
