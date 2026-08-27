/**
 * MCP tools for swaps: discovery, estimate, execute, status.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { assertServerWritable, canSwap, parseNetworkId, type NetworkId } from "../config.js";
import { getBalance } from "../api/balances.js";
import {
  assetKey,
  createSwap,
  estimateSwap,
  executeSwap,
  getSwapStatus,
  listSwapAssetsFrom,
  listSwapAssetsTo,
  listSwapNetworks,
  resolveSwapAsset,
  type SwapAsset,
  type SwapSide,
} from "../api/swap.js";
import { signSwapTransactions } from "../signing/swap.js";
import { enforcePolicy } from "../policy.js";
import { logInfo } from "../log.js";
import {
  mcpToolConfig,
  swapAssetInputSchema,
  toolDefinition,
} from "./definitions.js";
import type { ToolHelpers } from "./helpers.js";

type AssetInput = z.infer<typeof swapAssetInputSchema>;

async function enrichAssets(
  items: SwapAsset[],
  addresses: Record<string, string>,
): Promise<
  Array<
    SwapAsset & {
      walletAddress?: string;
      balance?: string;
      balanceRaw?: string;
      /** Can sell this asset (local swap signing exists for the network). */
      executable: boolean;
      /** Can receive this asset (keystore has an address for the network). */
      receivable: boolean;
    }
  >
> {
  return Promise.all(
    items.map(async (asset) => {
      const net = parseNetworkId(asset.network);
      const executable = Boolean(net && canSwap(net));
      const walletAddress = net ? addresses[net] : undefined;
      const receivable = Boolean(walletAddress);
      let balance: string | undefined;
      let balanceRaw: string | undefined;
      if (walletAddress && net) {
        try {
          const bal = await getBalance(
            net,
            walletAddress,
            asset.address ?? undefined,
          );
          balance = bal.formatted;
          balanceRaw = bal.raw;
        } catch {
          // best-effort enrichment
        }
      }
      return {
        ...asset,
        walletAddress,
        balance,
        balanceRaw,
        executable,
        receivable,
      };
    }),
  );
}

async function buildSide(
  token: string,
  assetIn: AssetInput,
  walletAddress: string,
  amount: string | undefined,
  correlationId: string,
  fromForToLookup?: SwapAsset,
): Promise<SwapSide> {
  const asset = await resolveSwapAsset(token, assetIn, {
    correlationId,
    fromForToLookup,
  });
  return {
    asset,
    address: walletAddress,
    ...(amount !== undefined ? { amount } : {}),
  };
}

function requireSellAddress(
  addresses: Record<string, string>,
  network: string,
): { networkId: NetworkId; address: string } {
  const networkId = parseNetworkId(network);
  if (!networkId) {
    throw new Error(`Unknown or unsupported sell network "${network}".`);
  }
  if (!canSwap(networkId)) {
    throw new Error(
      `Swap sell/signing is not supported on "${networkId}" in this MCP build.`,
    );
  }
  const address = addresses[networkId];
  if (!address) {
    throw new Error(
      `No ${networkId} address in the keystore for sell side. Re-open the wallet session to sync addresses.`,
    );
  }
  return { networkId, address };
}

/** Buy side only needs a receive address — not local swap signing. */
function requireBuyAddress(
  addresses: Record<string, string>,
  network: string,
): { networkId: NetworkId; address: string } {
  const networkId = parseNetworkId(network);
  if (!networkId) {
    throw new Error(
      `Unknown or unsupported buy network "${network}". MCP has no keystore address for it.`,
    );
  }
  const address = addresses[networkId];
  if (!address) {
    throw new Error(
      `No ${networkId} address in the keystore for buy/receive side. Re-open the wallet session to sync addresses.`,
    );
  }
  return { networkId, address };
}

/** Shared prep for estimate_swap / execute_swap (session, maxMode, sides). */
async function prepareSwapSides(
  helpers: ToolHelpers,
  opts: {
    wallet?: string;
    from: AssetInput;
    to: AssetInput;
    amount?: string;
    maxMode?: boolean;
    correlationId: string;
  },
) {
  const { entry, mnemonic, token } = await helpers.session(
    opts.wallet,
    opts.correlationId,
  );
  const sell = requireSellAddress(entry.addresses, opts.from.network);
  const buy = requireBuyAddress(entry.addresses, opts.to.network);
  const useMax = Boolean(opts.maxMode);
  let sellAmount = opts.amount;
  if (useMax && !sellAmount) {
    const bal = await getBalance(
      sell.networkId,
      sell.address,
      opts.from.address ?? undefined,
    );
    sellAmount = bal.formatted;
    if (Number(bal.raw) <= 0) {
      throw new Error(
        `maxMode requested but ${opts.from.symbol} balance on ${sell.networkId} is zero.`,
      );
    }
  }
  if (!sellAmount) {
    throw new Error("amount is required unless maxMode is true.");
  }

  const fromSide = await buildSide(
    token,
    opts.from,
    sell.address,
    sellAmount,
    opts.correlationId,
  );
  const toSide = await buildSide(
    token,
    opts.to,
    buy.address,
    undefined,
    opts.correlationId,
    fromSide.asset,
  );

  return {
    entry,
    mnemonic,
    token,
    sell,
    buy,
    useMax,
    sellAmount,
    fromSide,
    toSide,
  };
}

export function registerSwapTools(server: McpServer, helpers: ToolHelpers): void {
  const { ok, withToolLog, session } = helpers;

  server.registerTool(
    "list_swap_networks",
    mcpToolConfig(toolDefinition("list_swap_networks")),
    async ({ wallet }) =>
      withToolLog("list_swap_networks", { wallet }, async ({ correlationId }) => {
        const { token } = await session(wallet, correlationId);
        const networks = await listSwapNetworks(token, { correlationId });
        return ok({
          correlationId,
          networks: networks.map((n) => {
            const id = parseNetworkId(n.name);
            return {
              ...n,
              networkId: id,
              executable: Boolean(id && canSwap(id)),
            };
          }),
        });
      }),
  );

  server.registerTool(
    "list_swap_assets",
    mcpToolConfig(toolDefinition("list_swap_assets")),
    async (args) =>
      withToolLog("list_swap_assets", args, async ({ correlationId }) => {
        const { entry, token } = await session(args.wallet, correlationId);
        let page;
        if (args.direction === "from") {
          page = await listSwapAssetsFrom(
            token,
            {
              search: args.search,
              networks: args.networks,
              page: args.page,
              pageSize: args.pageSize,
            },
            { correlationId },
          );
        } else {
          if (!args.fromNetwork || !args.fromSymbol) {
            throw new Error(
              "direction=to requires fromNetwork and fromSymbol (from a prior list_swap_assets from call).",
            );
          }
          page = await listSwapAssetsTo(
            token,
            {
              from: {
                network: args.fromNetwork,
                symbol: args.fromSymbol,
                address: args.fromAddress ?? null,
              },
              search: args.search,
              networks: args.networks,
              page: args.page,
              pageSize: args.pageSize,
            },
            { correlationId },
          );
        }
        const items = await enrichAssets(page.items, entry.addresses);
        return ok({
          correlationId,
          direction: args.direction,
          page: page.page,
          pageSize: page.pageSize,
          total: page.total,
          items,
        });
      }),
  );

  server.registerTool(
    "estimate_swap",
    mcpToolConfig(toolDefinition("estimate_swap")),
    async ({ wallet, from, to, amount, maxMode }) =>
      withToolLog(
        "estimate_swap",
        { wallet, from, to, amount, maxMode },
        async ({ correlationId }) => {
          const prep = await prepareSwapSides(helpers, {
            wallet,
            from,
            to,
            amount,
            maxMode,
            correlationId,
          });
          const est = await estimateSwap(
            prep.token,
            {
              from: prep.fromSide,
              to: prep.toSide,
              maxMode: prep.useMax,
            },
            { correlationId },
          );
          return ok({
            correlationId,
            operationId: est.operationId,
            provider: est.provider,
            amountFrom: est.from.amount ?? prep.sellAmount,
            amountTo: est.to.amount,
            correctedAmountFrom: est.correctedAmountFrom,
            correctedAmountTo: est.correctedAmountTo,
            fees: est.details?.fees,
            details: est.details,
            from: est.from,
            to: est.to,
            note: "Quote may expire. Call execute_swap to create+sign+broadcast (it performs a fresh estimate).",
          });
        },
      ),
  );

  server.registerTool(
    "execute_swap",
    mcpToolConfig(toolDefinition("execute_swap")),
    async ({ wallet, from, to, amount, maxMode }) =>
      withToolLog(
        "execute_swap",
        { wallet, from, to, amount, maxMode },
        async ({ correlationId, started }) => {
          assertServerWritable("swap");
          const prep = await prepareSwapSides(helpers, {
            wallet,
            from,
            to,
            amount,
            maxMode,
            correlationId,
          });

          enforcePolicy(prep.entry, {
            kind: "swap",
            network: prep.sell.networkId,
          });

          logInfo("tool.execute_swap.estimate", {
            correlationId,
            from: assetKey(prep.fromSide.asset),
            to: assetKey(prep.toSide.asset),
            amount: prep.sellAmount,
            maxMode: prep.useMax,
          });
          const est = await estimateSwap(
            prep.token,
            {
              from: prep.fromSide,
              to: prep.toSide,
              maxMode: prep.useMax,
            },
            { correlationId },
          );
          if (!est.operationId) {
            throw new Error("Swap estimate returned no operationId.");
          }
          // Mobile: from.amount = requested sellAmount; correctedAmountFrom separate.
          const corrected =
            est.correctedAmountFrom ?? est.from.amount ?? prep.sellAmount;

          enforcePolicy(prep.entry, {
            kind: "swap",
            network: prep.sell.networkId,
            amount: corrected,
          });

          const createFrom: SwapSide = {
            ...prep.fromSide,
            amount: prep.sellAmount,
          };

          const created = await createSwap(
            prep.token,
            {
              operationId: est.operationId,
              correctedAmountFrom: corrected,
              from: createFrom,
              to: prep.toSide,
              maxMode: prep.useMax,
            },
            { correlationId },
          );
          if (created.txsToSign.length === 0) {
            throw new Error("Swap create returned no transactions to sign.");
          }
          if (!created.swapOrderId) {
            throw new Error(
              "Swap create returned no swapOrderId (order.uid). Cannot execute.",
            );
          }

          const signed = await signSwapTransactions(
            prep.sell.networkId,
            prep.mnemonic,
            created.txsToSign,
          );
          if (signed.length === 0) {
            throw new Error("No transactions were signed for this swap.");
          }

          const executed = await executeSwap(
            prep.token,
            {
              operationId: created.operationId,
              swapOrderId: created.swapOrderId,
              from: createFrom,
              to: prep.toSide,
              signedTransactions: signed,
            },
            { correlationId },
          );

          const preferred =
            signed.find(
              (t) =>
                t.type === "MainTransfer" || t.type === "ExternalContractCall",
            ) ?? signed[0];

          return ok({
            correlationId,
            operationId: executed.operationId,
            swapOrderId: created.swapOrderId,
            txHash: executed.txHash ?? preferred?.txHash,
            amountFrom: corrected,
            amountTo: est.to.amount,
            provider: created.provider ?? est.provider,
            fromNetwork: prep.sell.networkId,
            toNetwork: prep.buy.networkId,
            elapsedMs: Date.now() - started,
            note: "Poll get_swap_status with operationId until complete. Do not re-execute blindly after a timeout.",
          });
        },
      ),
  );

  server.registerTool(
    "get_swap_status",
    mcpToolConfig(toolDefinition("get_swap_status")),
    async ({ wallet, operationId }) =>
      withToolLog(
        "get_swap_status",
        { wallet, operationId },
        async ({ correlationId }) => {
          const { token } = await session(wallet, correlationId);
          const status = await getSwapStatus(token, operationId, {
            correlationId,
          });
          return ok({ correlationId, ...status });
        },
      ),
  );
}
