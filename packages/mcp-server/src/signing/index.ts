/** Signer registry: dispatch to the per-network implementation. */

import type { NetworkId } from "../config.js";
import { deriveKey } from "../wallet/derive.js";
import { dispatchSign } from "./dispatch.js";
import type { SignedTransaction, TransactionToSign } from "./types.js";
import { logError, logInfo } from "../log.js";

export type { SignedTransaction, TransactionToSign } from "./types.js";
export { dispatchSign } from "./dispatch.js";

/**
 * Derive the key for `network` from the mnemonic and sign every transaction.
 * The mnemonic stays inside this call; only signatures are returned.
 */
export async function signForward(
  network: NetworkId,
  mnemonic: string,
  txs: TransactionToSign[],
): Promise<SignedTransaction[]> {
  const started = Date.now();
  const { privateKey, address } = deriveKey(mnemonic, network);
  const ctx = { privateKey, address };
  logInfo("sign.start", {
    network,
    address,
    txCount: txs.length,
    txs: txs.map((t, i) => ({
      i,
      transactionId: t.transactionId,
      txId: t.txId,
      type: t.type,
      hasTxData: Boolean(t.txData),
      txDataLen: t.txData?.length,
      hasExtraData: Boolean(t.extraData),
      extraDataLen: t.extraData?.length,
      value: t.value,
    })),
  });
  try {
    const signed = await dispatchSign(network, ctx, txs);
    logInfo("sign.ok", {
      network,
      address,
      elapsedMs: Date.now() - started,
      signedCount: signed.length,
      signed: signed.map((t, i) => ({
        i,
        transactionId: t.transactionId,
        txID: t.txID,
        signatureLen: t.signature?.length,
        txDataLen: t.txData?.length,
      })),
    });
    return signed;
  } catch (e) {
    logError("sign.fail", e, {
      network,
      address,
      txCount: txs.length,
      elapsedMs: Date.now() - started,
    });
    throw e;
  }
}
