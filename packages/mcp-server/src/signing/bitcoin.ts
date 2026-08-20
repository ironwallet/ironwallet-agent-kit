/**
 * UTXO forward signing for Bitcoin / Litecoin / Dogecoin, matching the shared
 * hd-wallet-service relay contract (and mobile BitcoinTransactionSigner):
 *
 *   - `txData`    = unsigned raw tx, lowercase hex.
 *   - `extraData` = JSON array of per-input UTXO info; utxos[0].scriptPubKey (hex)
 *                   and utxos[0].value (sats / litoshis / koinu) drive the sighash.
 *   - SegWit P2WPKH (BTC BIP-84, LTC BIP-84): BIP-143 witness, SIGHASH_ALL.
 *   - Legacy P2PKH (DOGE BIP-44): classic sighash + scriptSig. Signed via
 *     `allowLegacyWitnessUtxo` using scriptPubKey+value from extraData (relay
 *     does not provide full prev txs).
 *   - Forward payload: `signature` = full signed raw tx hex, original `txData`,
 *     computed `txID`.
 */

import * as btc from "@scure/btc-signer";
import { hex } from "@scure/base";
import type { SignContext, SignedTransaction, TransactionToSign } from "./types.js";
import { logInfo } from "../log.js";

interface UtxoInfo {
  scriptPubKey: string;
  value: number;
}

interface ExtraDataItem {
  index?: number;
  utxos?: UtxoInfo[];
}

function hexToBytes(h: string): Uint8Array {
  return hex.decode(h.replace(/^0x/, "").toLowerCase());
}

export function signBitcoin(
  ctx: SignContext,
  txs: TransactionToSign[],
): SignedTransaction[] {
  return signUtxo(ctx, txs, "bitcoin");
}

export function signLitecoin(
  ctx: SignContext,
  txs: TransactionToSign[],
): SignedTransaction[] {
  return signUtxo(ctx, txs, "litecoin");
}

export function signDoge(
  ctx: SignContext,
  txs: TransactionToSign[],
): SignedTransaction[] {
  return signUtxo(ctx, txs, "doge");
}

function signUtxo(
  ctx: SignContext,
  txs: TransactionToSign[],
  network: "bitcoin" | "litecoin" | "doge",
): SignedTransaction[] {
  const priv = hexToBytes(ctx.privateKey);
  const signed: SignedTransaction[] = [];
  logInfo(`sign.${network}.start`, { address: ctx.address, txCount: txs.length });

  for (const item of txs) {
    if (!item.txData) throw new Error(`${network} transactionToSign has no txData.`);
    if (!item.extraData) {
      throw new Error(`${network} transactionToSign has no extraData (UTXO info).`);
    }

    const tx = btc.Transaction.fromRaw(hexToBytes(item.txData), {
      allowUnknownInputs: true,
      allowUnknownOutputs: true,
      disableScriptCheck: true,
      // DOGE (and any legacy P2PKH input) signs from scriptPubKey+value alone.
      allowLegacyWitnessUtxo: true,
      lowR: true,
    });

    const extra = JSON.parse(item.extraData) as ExtraDataItem[];
    const byIndex = new Map<number, UtxoInfo>();
    extra.forEach((e, i) => {
      const utxo = e.utxos?.[0];
      if (utxo) byIndex.set(e.index ?? i, utxo);
    });

    for (let i = 0; i < tx.inputsLength; i++) {
      const utxo = byIndex.get(i);
      if (!utxo) throw new Error(`No UTXO info for ${network} input ${i}.`);
      tx.updateInput(i, {
        witnessUtxo: {
          script: hexToBytes(utxo.scriptPubKey),
          amount: BigInt(utxo.value),
        },
      });
    }

    tx.sign(priv);
    tx.finalize();

    logInfo(`sign.${network}.tx`, {
      transactionId: item.transactionId,
      txID: tx.id,
      inputs: tx.inputsLength,
      outputs: tx.outputsLength,
      signedLen: tx.hex.length,
    });
    signed.push({
      signature: tx.hex,
      txData: item.txData,
      txID: tx.id,
      transactionId: item.transactionId,
    });
  }

  return signed;
}
