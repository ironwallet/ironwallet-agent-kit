/**
 * MCP tool catalog: Zod input schemas plus the short docs fields used in
 * README / skill tables. Handlers stay in wallets.ts / transfer.ts / swap.ts.
 * `tools.json` is generated from this file — do not edit that JSON by hand.
 */

import { z, type ZodRawShape } from "zod";
import { ALL_NETWORKS, type NetworkId } from "../networks.js";

export const networkEnum = z.enum([...ALL_NETWORKS] as [NetworkId, ...NetworkId[]]);

export const swapAssetInputSchema = z.object({
  network: z.string().describe("Network id, e.g. ethereum, bsc, bitcoin."),
  symbol: z.string().describe("Asset symbol, e.g. ETH, USDT."),
  address: z
    .string()
    .optional()
    .nullable()
    .describe("Token contract address. Omit/null for the native coin."),
  decimals: z
    .number()
    .int()
    .optional()
    .describe(
      "Token decimals. If omitted, resolved via SWP catalog (paged). Prefer passing decimals (+ address for tokens) from list_swap_assets.",
    ),
});

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  /** One-line purpose for markdown tool tables. */
  purpose: string;
  movesFunds: boolean;
  inputSchema: ZodRawShape;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_wallets",
    title: "List wallets",
    description:
      "List the wallets in the local keystore with their addresses per network. Each wallet includes policy ({ enabled: false } when unset). Never returns private keys or seed phrases.",
    purpose: "Names, addresses, and `policy`",
    movesFunds: false,
    inputSchema: {},
  },
  {
    name: "create_wallets",
    title: "Create wallets",
    description:
      "Generate one or more brand-new wallets (BIP-39). Returns names and addresses only. Seed phrases are NOT returned to the agent. The response includes a local browser URL where the user can view and back up the recovery phrases.",
    purpose: "New wallets; returns a browser `backup_url`",
    movesFunds: false,
    inputSchema: {
      count: z.number().int().min(1).max(50).describe("How many wallets to create."),
      name_prefix: z
        .string()
        .optional()
        .describe("Optional name prefix, e.g. 'agent-hot'. Defaults to 'wallet'."),
    },
  },
  {
    name: "open_wallet_manager",
    title: "Open wallet manager (browser)",
    description:
      "Open a local browser form to add/import/create wallets or back them up (reveal the recovery phrase). Returns a localhost URL for the user to open. Seed phrases are entered and shown ONLY in the browser and never pass through the agent. Use this whenever the user asks to add, import, create, or back up a wallet.",
    purpose: "Local browser UI to import / create / back up",
    movesFunds: false,
    inputSchema: {},
  },
  {
    name: "get_deposit_qr",
    title: "Deposit QR",
    description:
      "PNG QR to receive funds (generated on the fly; IW mark, address under the code). Pass network for one chain; omit it for one QR per unique address. Does not move funds. Never returns keys or seed phrases. Show the attached image in chat when the host renders it. Each item also has qr_url — open that local URL if the user cannot see the QR, and always write the address in the reply.",
    purpose: "PNG QR (try chat; else local `qr_url`)",
    movesFunds: false,
    inputSchema: {
      wallet: z.string().optional().describe("Wallet name. Optional if only one exists."),
      network: networkEnum
        .optional()
        .describe("Network to deposit on. Omit to return one QR per unique address."),
    },
  },
  {
    name: "get_balance",
    title: "Get balance",
    description:
      "Get the balance for a wallet on a network. Optionally pass a token contract address; omit for the native coin.",
    purpose: "Native or token balance",
    movesFunds: false,
    inputSchema: {
      wallet: z.string().optional().describe("Wallet name. Optional if only one exists."),
      network: networkEnum,
      tokenAddress: z
        .string()
        .optional()
        .describe("Token contract address. Omit for the native coin."),
    },
  },
  {
    name: "estimate_transfer",
    title: "Estimate transfer",
    description:
      "Estimate fees for a transfer without sending. Returns fees and the number of transactions that would be signed.",
    purpose: "Fee estimate, no broadcast",
    movesFunds: false,
    inputSchema: {
      wallet: z.string().optional(),
      network: networkEnum,
      to: z.string().describe("Recipient address."),
      amount: z.string().describe("Amount in asset units (decimal string)."),
      tokenAddress: z
        .string()
        .optional()
        .describe("Token contract address. Omit for the native coin."),
      memo: z.string().optional(),
    },
  },
  {
    name: "send_transfer",
    title: "Send transfer",
    description:
      "Send a transfer: sign locally with the wallet's key and broadcast via the IronWallet forward relay (estimate -> sign -> forward) for EVM, Tron, Bitcoin, Litecoin, Doge, Solana, XRP and TON. Irreversible once broadcast — no second confirmation. Returns the transaction hash (and operation id where applicable).",
    purpose: "Sign locally and send",
    movesFunds: true,
    inputSchema: {
      wallet: z.string().optional(),
      network: networkEnum,
      to: z.string().describe("Recipient address."),
      amount: z.string().describe("Amount in asset units (decimal string)."),
      tokenAddress: z
        .string()
        .optional()
        .describe("Token contract address. Omit for the native coin."),
      memo: z.string().optional(),
    },
  },
  {
    name: "get_operation_status",
    title: "Get operation status",
    description: "Poll the state of a forward operation by its operation id.",
    purpose: "Poll a transfer",
    movesFunds: false,
    inputSchema: {
      wallet: z.string().optional(),
      network: networkEnum,
      operationId: z.string(),
    },
  },
  {
    name: "list_swap_networks",
    title: "List swap networks",
    description: "List networks available for swaps. Use before listing swap assets.",
    purpose: "Networks available for swap",
    movesFunds: false,
    inputSchema: {
      wallet: z.string().optional(),
    },
  },
  {
    name: "list_swap_assets",
    title: "List swap assets",
    description:
      "List tradable assets. direction=from lists sell assets; direction=to requires fromNetwork/fromSymbol (and fromAddress for tokens) and lists buy assets. Enriches with wallet address and balance when possible.",
    purpose: "Sell / buy catalog",
    movesFunds: false,
    inputSchema: {
      wallet: z.string().optional(),
      direction: z.enum(["from", "to"]),
      fromNetwork: z.string().optional(),
      fromSymbol: z.string().optional(),
      fromAddress: z.string().optional().nullable(),
      search: z.string().optional(),
      networks: z.array(z.string()).optional(),
      page: z.number().int().positive().optional(),
      pageSize: z.number().int().positive().max(100).optional(),
    },
  },
  {
    name: "estimate_swap",
    title: "Estimate swap",
    description:
      "Get a swap quote (amounts, fees, operationId). Quote can expire — prefer execute_swap for sending (it re-estimates). Amount is a decimal string; set maxMode=true to sell the full balance (backend corrects amount).",
    purpose: "Quote (may expire)",
    movesFunds: false,
    inputSchema: {
      wallet: z.string().optional(),
      from: swapAssetInputSchema,
      to: swapAssetInputSchema,
      amount: z
        .string()
        .optional()
        .describe("Sell amount as decimal string. Required unless maxMode."),
      maxMode: z.boolean().optional(),
    },
  },
  {
    name: "execute_swap",
    title: "Execute swap",
    description:
      "Execute a swap: fresh estimate → create → local sign → execute. Does NOT use the transfer relay. Irreversible once submitted — no second confirmation. Returns operationId and txHash; poll with get_swap_status.",
    purpose: "Fresh quote → sign → swap",
    movesFunds: true,
    inputSchema: {
      wallet: z.string().optional(),
      from: swapAssetInputSchema,
      to: swapAssetInputSchema,
      amount: z
        .string()
        .optional()
        .describe("Sell amount as decimal string. Required unless maxMode."),
      maxMode: z.boolean().optional(),
    },
  },
  {
    name: "get_swap_status",
    title: "Get swap status",
    description: "Poll swap order/operation status by operationId.",
    purpose: "Poll a swap",
    movesFunds: false,
    inputSchema: {
      wallet: z.string().optional(),
      operationId: z.string(),
    },
  },
];

const BY_NAME = new Map(TOOL_DEFINITIONS.map((t) => [t.name, t]));

export function toolDefinition(name: string): ToolDefinition {
  const def = BY_NAME.get(name);
  if (!def) throw new Error(`Unknown tool "${name}".`);
  return def;
}

/** Fields passed to `server.registerTool` (docs-only keys stripped). */
export function mcpToolConfig(def: ToolDefinition): {
  title: string;
  description: string;
  inputSchema: ZodRawShape;
} {
  return {
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema,
  };
}
