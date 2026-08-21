/**
 * EVM forward signing, matching the mobile app's `forwardToTransferRelay`:
 *
 *  1. Parse `txData` as a serialized UNSIGNED transaction (RLP; typed 0x02 for
 *     EIP-1559).
 *  2. Override nonce: start from on-chain getTransactionCount(address),
 *     increment per transaction in the batch.
 *  3. Use a live chainId from the RPC node.
 *  4. Sign. ethers serializes typed transactions with their type prefix byte
 *     included, matching the app's manual 0x02 prepend.
 *  5. Response: `signature` = full signed serialized tx hex, `txData` = the
 *     original unsigned txData unchanged.
 */

import { Transaction, Wallet } from "ethers";
import type { NetworkId } from "../config.js";
import { providerFor } from "../api/rpc.js";
import type { SignContext, SignedTransaction, TransactionToSign } from "./types.js";
import { logInfo } from "../log.js";

export async function signEvm(
  network: NetworkId,
  ctx: SignContext,
  txs: TransactionToSign[],
): Promise<SignedTransaction[]> {
  const provider = providerFor(network);
  const wallet = new Wallet(ctx.privateKey);

  const [chainId, startNonce] = await Promise.all([
    provider.getNetwork().then((n) => n.chainId),
    provider.getTransactionCount(ctx.address, "latest"),
  ]);
  logInfo("sign.evm.context", {
    network,
    address: ctx.address,
    chainId: chainId.toString(),
    startNonce,
    txCount: txs.length,
  });

  let nonce = startNonce;
  const signed: SignedTransaction[] = [];

  for (const item of txs) {
    if (!item.txData) throw new Error("EVM transactionToSign has no txData.");
    const tx = Transaction.from(item.txData);
    tx.nonce = nonce++;
    tx.chainId = chainId;
    const serialized = await wallet.signTransaction(tx);
    logInfo("sign.evm.tx", {
      network,
      transactionId: item.transactionId,
      nonce: tx.nonce,
      chainId: chainId.toString(),
      type: tx.type,
      to: tx.to,
      value: tx.value?.toString(),
      signedLen: serialized.length,
    });
    signed.push({
      signature: serialized,
      txData: item.txData,
      txID: item.txId ?? "",
      transactionId: item.transactionId,
    });
  }

  return signed;
}
