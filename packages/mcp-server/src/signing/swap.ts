/**
 * Sign SWP create `txsToSign` into execute `signedTransactions`.
 * Reuses per-network transfer signers via `dispatchSign`; maps to SWP DTO fields
 * ({ type, signedTx, txData, txHash, txId }).
 *
 * EVM: live nonce/chainId already in signEvm; txHash = keccak256(signed tx).
 */

import { keccak256, Transaction } from "ethers";
import { canSwap, isEvmNetwork, type NetworkId } from "../config.js";
import { deriveKey } from "../wallet/derive.js";
import type { SwapSignedTxDto, SwapTxToSign } from "../api/swap.js";
import { dispatchSign } from "./dispatch.js";
import type { SignedTransaction, TransactionToSign } from "./types.js";
import { logError, logInfo } from "../log.js";

function toSignItems(txs: SwapTxToSign[]): TransactionToSign[] {
  return txs
    .filter((t) => t.txData)
    .map((t) => ({
      txId: t.txId,
      txData: t.txData,
      extraData: t.extraData,
      type: t.type,
      transactionId: t.txId,
    }));
}

function evmTxHash(signedHex: string): string {
  try {
    return Transaction.from(signedHex).hash ?? keccak256(signedHex);
  } catch {
    return keccak256(signedHex);
  }
}

/**
 * Map signer output → SWP execute DTO. Must match mobile forwardToSwap:
 *   EVM / Tron / Bitcoin / Solana: signedTx=signature, txData=original unsigned
 *   TON:  signedTx=txData=external message BoC hex
 *   XRP:  signedTx=TxnSignature, txData=signed blob
 */
function mapSigned(
  network: NetworkId,
  original: SwapTxToSign[],
  signed: SignedTransaction[],
): SwapSignedTxDto[] {
  const out: SwapSignedTxDto[] = [];
  let si = 0;
  for (const orig of original) {
    if (!orig.txData) continue;
    const s = signed[si++];
    if (!s) throw new Error("Signer returned fewer transactions than expected.");
    const txId = orig.txId ?? s.txID ?? "";
    const signedTx = s.signature;
    let txData: string;
    let txHash: string;
    if (network === "ton") {
      // Mobile: both fields are the signed external-message BoC.
      txData = signedTx;
      txHash = s.txID || txId;
    } else if (network === "xrp") {
      txData = s.txData; // signed blob
      txHash = s.txID || txId;
    } else if (isEvmNetwork(network)) {
      txData = orig.txData;
      txHash = evmTxHash(signedTx);
    } else {
      // tron, bitcoin, solana — original unsigned txData
      txData = orig.txData;
      txHash = s.txID || txId;
    }
    out.push({
      type: orig.type ?? "",
      signedTx,
      txData,
      txHash,
      txId,
    });
  }
  return out;
}

export async function signSwapTransactions(
  network: NetworkId,
  mnemonic: string,
  txs: SwapTxToSign[],
): Promise<SwapSignedTxDto[]> {
  if (!canSwap(network)) {
    throw new Error(`Swap signing is not supported on "${network}".`);
  }
  const started = Date.now();
  const { privateKey, address } = deriveKey(mnemonic, network);
  const ctx = { privateKey, address };
  const items = toSignItems(txs);
  logInfo("sign.swap.start", {
    network,
    address,
    txCount: items.length,
    types: items.map((t) => t.type),
  });
  try {
    const signed = await dispatchSign(network, ctx, items);
    const mapped = mapSigned(network, txs, signed);
    logInfo("sign.swap.ok", {
      network,
      address,
      elapsedMs: Date.now() - started,
      signedCount: mapped.length,
    });
    return mapped;
  } catch (e) {
    logError("sign.swap.fail", e, {
      network,
      address,
      txCount: items.length,
      elapsedMs: Date.now() - started,
    });
    throw e;
  }
}
