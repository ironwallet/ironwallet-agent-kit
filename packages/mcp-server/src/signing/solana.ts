/**
 * Solana forward signing, matching the mobile app's relay path
 * (solana_net_api_client.forwardToTransferRelay):
 *
 *   - `txData` = the serialized *compiled message* bytes (hex, optional 0x). It is
 *     a message only, not a full transaction (no signatures yet).
 *   - Before signing, the mobile client fetches a fresh `latestBlockhash` and
 *     swaps it into the message, then ed25519-signs the message bytes.
 *   - The forward request carries the *entire* signed transaction wire bytes as
 *     hex in `signature` ([compact-u16 numSigs][sigs][message]), the base58 first
 *     signature in `txID`, and the original estimate `txData` (unchanged).
 *
 * We only support single-signer transfers (the fee payer, account index 0, is the
 * wallet). The recent blockhash sits right after the static account keys in both
 * legacy and v0 messages, so the swap works for either.
 */

import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519.js";
import { getConfig } from "../config.js";
import { httpJson } from "../api/http.js";
import type { SignContext, SignedTransaction, TransactionToSign } from "./types.js";
import { logInfo } from "../log.js";

function hexToBytes(h: string): Uint8Array {
  return Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
}

/** Decode a Solana compact-u16 (shortvec) length. Returns [value, bytesRead]. */
function decodeCompactU16(buf: Uint8Array, offset: number): [number, number] {
  let value = 0;
  let read = 0;
  for (;;) {
    const byte = buf[offset + read];
    value |= (byte & 0x7f) << (read * 7);
    read++;
    if ((byte & 0x80) === 0) break;
    if (read > 3) throw new Error("Invalid compact-u16 in Solana message.");
  }
  return [value >>> 0, read];
}

async function latestBlockhash(): Promise<Uint8Array> {
  const cfg = getConfig();
  const res = await httpJson<{ result?: { value?: { blockhash?: string } } }>(
    cfg.solanaRpcUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getLatestBlockhash",
        params: [{ commitment: "finalized" }],
      }),
    },
    { retry: true },
  );
  const bh = res.result?.value?.blockhash;
  if (!bh) throw new Error("Failed to fetch Solana latest blockhash.");
  return bs58.decode(bh);
}

/** Locate the 32-byte recent-blockhash offset within a compiled message. */
function blockhashOffset(msg: Uint8Array): { offset: number; numSigners: number } {
  const versioned = (msg[0] & 0x80) !== 0;
  const headerStart = versioned ? 1 : 0;
  const numSigners = msg[headerStart];
  const keysCountAt = headerStart + 3; // after the 3 header bytes
  const [numKeys, read] = decodeCompactU16(msg, keysCountAt);
  return { offset: keysCountAt + read + numKeys * 32, numSigners };
}

export async function signSolana(
  ctx: SignContext,
  txs: TransactionToSign[],
): Promise<SignedTransaction[]> {
  const priv = hexToBytes(ctx.privateKey); // 32-byte ed25519 seed
  const blockhash = await latestBlockhash();
  const signed: SignedTransaction[] = [];
  logInfo("sign.solana.start", {
    address: ctx.address,
    txCount: txs.length,
    blockhash: bs58.encode(blockhash),
  });

  for (const item of txs) {
    if (!item.txData) throw new Error("Solana transactionToSign has no txData.");
    const message = hexToBytes(item.txData);

    const { offset, numSigners } = blockhashOffset(message);
    if (numSigners !== 1) {
      throw new Error(
        `Solana tx requires ${numSigners} signers; only single-signer transfers are supported.`,
      );
    }
    message.set(blockhash, offset);

    const sig = ed25519.sign(message, priv);

    // Wire format: [compact-u16 numSignatures = 1][signature][message]
    const tx = new Uint8Array(1 + 64 + message.length);
    tx[0] = 1;
    tx.set(sig, 1);
    tx.set(message, 65);

    const txID = bs58.encode(sig);
    logInfo("sign.solana.tx", {
      transactionId: item.transactionId,
      txID,
      numSigners,
      signedLen: tx.length,
    });
    signed.push({
      signature: Buffer.from(tx).toString("hex"),
      txData: item.txData,
      txID,
      transactionId: item.transactionId,
    });
  }

  return signed;
}
