/**
 * Tron forward signing, matching the mobile app's tron_client signer:
 *
 *  - The estimate returns `txId` = the transaction hash (hex).
 *  - Sign the raw 32-byte txId bytes directly with secp256k1 (no extra hashing).
 *  - Signature bytes = r(32) || s(32) || v(1), where v is 27/28 (web3dart's
 *    recovery id + 27). Encoded as a 130-char hex string.
 *  - `txData` and `txID` are returned unchanged from the estimate.
 */

import { SigningKey, getBytes, hexlify, zeroPadValue } from "ethers";
import type { SignContext, SignedTransaction, TransactionToSign } from "./types.js";
import { logInfo } from "../log.js";

export function signTron(
  ctx: SignContext,
  txs: TransactionToSign[],
): SignedTransaction[] {
  const key = new SigningKey(ctx.privateKey);
  const signed: SignedTransaction[] = [];
  logInfo("sign.tron.start", { address: ctx.address, txCount: txs.length });

  for (const item of txs) {
    if (!item.txId) throw new Error("Tron transactionToSign has no txId.");
    if (!item.txData) throw new Error("Tron transactionToSign has no txData.");

    const digest = getBytes("0x" + item.txId.replace(/^0x/, ""));
    const sig = key.sign(digest);

    const r = getBytes(zeroPadValue(sig.r, 32)); // 32 bytes
    const s = getBytes(zeroPadValue(sig.s, 32)); // 32 bytes
    const v = sig.v; // 27 or 28

    const raw = new Uint8Array(65);
    raw.set(r, 0);
    raw.set(s, 32);
    raw[64] = v;

    signed.push({
      signature: hexlify(raw).replace(/^0x/, ""), // 130 hex chars, no 0x prefix
      txData: item.txData,
      txID: item.txId,
      transactionId: item.transactionId,
    });
  }

  return signed;
}
