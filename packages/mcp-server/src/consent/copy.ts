/**
 * Canonical MCP consent copy (English). Chat, create_wallets, and the local
 * manager must show this text. Bump CONSENT_VERSION when the wording changes.
 */

export const CONSENT_VERSION = "v2";

export const CONSENT_TITLE = "Before connecting an AI agent to your wallet";

export const CONSENT_LEAD =
  "Connecting MCP lets the AI agent view balances, transfer assets, and swap on behalf of this wallet.";

export const CONSENT_BULLETS = [
  "The experience depends on the AI host. Cursor offers the most complete support, Claude Code works well, and Claude Desktop chat is more limited. A paid agent plan is recommended for best results.",
  "By default the agent can send funds and swap without extra confirmation on each operation.",
  "Use a dedicated wallet with a small balance, not your main or savings wallet.",
  "The recovery phrase stays encrypted on this device. Loss or compromise means permanent loss of access to the funds.",
  "IronWallet is not responsible for the AI agent's actions, misconfiguration, or loss of funds from using this feature.",
  "You can ask the agent to set limits in chat (read-only, a per-transaction USD limit, a transfer recipient allow-list).",
] as const;

export const CONSENT_CHECKBOX = "I understand the risks and want to continue";

export const CONSENT_CHAT_INSTRUCTION =
  "Show this text in full in chat. Do not shorten it. After the user explicitly confirms, call accept_mcp_consent with accepted=true, or open the wallet manager so they can accept there.";

export function consentDocument(): {
  version: string;
  title: string;
  lead: string;
  bullets: readonly string[];
  checkbox: string;
  instruction: string;
} {
  return {
    version: CONSENT_VERSION,
    title: CONSENT_TITLE,
    lead: CONSENT_LEAD,
    bullets: CONSENT_BULLETS,
    checkbox: CONSENT_CHECKBOX,
    instruction: CONSENT_CHAT_INSTRUCTION,
  };
}
