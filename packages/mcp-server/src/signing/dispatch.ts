/**
 * Per-network signing dispatch shared by transfer (`signForward`) and swap
 * (`signSwapTransactions`).
 */

import { isEvmNetwork, type NetworkId } from "../config.js";
import { signEvm } from "./evm.js";
import { signTron } from "./tron.js";
import { signBitcoin, signDoge, signLitecoin } from "./bitcoin.js";
import { signSolana } from "./solana.js";
import { signXrp } from "./xrp.js";
import { signTon } from "./ton.js";
import type { SignContext, SignedTransaction, TransactionToSign } from "./types.js";

export async function dispatchSign(
  network: NetworkId,
  ctx: SignContext,
  txs: TransactionToSign[],
): Promise<SignedTransaction[]> {
  if (isEvmNetwork(network)) {
    return signEvm(network, ctx, txs);
  }
  switch (network) {
    case "tron":
      return signTron(ctx, txs);
    case "bitcoin":
      return signBitcoin(ctx, txs);
    case "litecoin":
      return signLitecoin(ctx, txs);
    case "doge":
      return signDoge(ctx, txs);
    case "solana":
      return signSolana(ctx, txs);
    case "xrp":
      return signXrp(ctx, txs);
    case "ton":
      return signTon(ctx, txs);
    default:
      throw new Error(`Signing is not supported on "${network as string}".`);
  }
}
