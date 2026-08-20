/**
 * XRP forward / swap signing, matching the mobile app's xrp_net_client:
 *
 *   - `txData` = an XRPL transaction blob (hex).
 *   - Decode → set SigningPubKey → autofill Sequence/Fee/LastLedgerSequence →
 *     secp256k1 sign → re-encode signed blob.
 *   - Forward/SWP payload: `signature` = TxnSignature hex, `txData` = signed
 *     blob hex, `txID` = transaction hash.
 */

import { encode, decode, encodeForSigning } from "ripple-binary-codec";
import { sign as rippleSign } from "ripple-keypairs";
import { SigningKey } from "ethers";
import { sha512 } from "@noble/hashes/sha2.js";
import { getConfig } from "../config.js";
import { httpJson } from "../api/http.js";
import type { SignContext, SignedTransaction, TransactionToSign } from "./types.js";
import { logInfo } from "../log.js";

const TX_HASH_PREFIX = Uint8Array.from([0x54, 0x58, 0x4e, 0x00]); // "TXN\0"

/** XRPL JSON-RPC ({ method, params: [ {...} ] } envelope). */
async function xrpRpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const cfg = getConfig();
  const res = await httpJson<{ result?: T & { error?: string } }>(
    cfg.xrpRpcUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params: [params] }),
    },
    { retry: true },
  );
  const result = res.result;
  if (!result) throw new Error(`XRPL ${method} returned no result.`);
  if (result.error) throw new Error(`XRPL ${method} failed: ${result.error}`);
  return result;
}

async function accountSequence(account: string): Promise<number> {
  const r = await xrpRpc<{ account_data?: { Sequence?: number } }>("account_info", {
    account,
    ledger_index: "current",
  });
  const seq = r.account_data?.Sequence;
  if (seq == null) throw new Error("Could not read XRP account Sequence.");
  return seq;
}

async function openLedgerFee(): Promise<string> {
  try {
    const r = await xrpRpc<{ drops?: { open_ledger_fee?: string; base_fee?: string } }>(
      "fee",
      {},
    );
    return r.drops?.open_ledger_fee ?? r.drops?.base_fee ?? "12";
  } catch {
    return "12";
  }
}

async function currentLedgerIndex(): Promise<number> {
  const r = await xrpRpc<{ ledger_current_index?: number }>("ledger_current", {});
  return r.ledger_current_index ?? 0;
}

function txHash(signedBlobHex: string): string {
  const blob = Uint8Array.from(Buffer.from(signedBlobHex, "hex"));
  const buf = new Uint8Array(TX_HASH_PREFIX.length + blob.length);
  buf.set(TX_HASH_PREFIX, 0);
  buf.set(blob, TX_HASH_PREFIX.length);
  return Buffer.from(sha512(buf).slice(0, 32)).toString("hex").toUpperCase();
}

export async function signXrp(
  ctx: SignContext,
  txs: TransactionToSign[],
): Promise<SignedTransaction[]> {
  if (txs.length === 0) throw new Error("XRP transactionToSign list is empty.");
  logInfo("sign.xrp.start", {
    address: ctx.address,
    txCount: txs.length,
  });

  const pubKey = SigningKey.computePublicKey(ctx.privateKey, true)
    .replace(/^0x/, "")
    .toUpperCase();
  const ripplePriv = ("00" + ctx.privateKey.replace(/^0x/, "")).toUpperCase();

  let nextSequence: number | undefined;
  const fee = await openLedgerFee();
  const ledger = await currentLedgerIndex();
  const signed: SignedTransaction[] = [];

  for (const item of txs) {
    if (!item.txData) throw new Error("XRP transactionToSign has no txData.");

    const tx = decode(item.txData.replace(/^0x/, "").toUpperCase()) as Record<
      string,
      unknown
    >;
    tx.SigningPubKey = pubKey;
    if (tx.Account == null) tx.Account = ctx.address;

    if (tx.Sequence == null) {
      if (nextSequence === undefined) {
        nextSequence = await accountSequence(ctx.address);
      }
      tx.Sequence = nextSequence;
      nextSequence += 1;
    } else if (typeof tx.Sequence === "number") {
      nextSequence = tx.Sequence + 1;
    }

    if (tx.Fee == null) tx.Fee = fee;
    if (tx.LastLedgerSequence == null) {
      tx.LastLedgerSequence = ledger + 20;
    }

    const signingData = encodeForSigning(tx);
    tx.TxnSignature = rippleSign(signingData, ripplePriv);

    const signedBlob = encode(tx);
    const hash = txHash(signedBlob);
    logInfo("sign.xrp.tx", {
      address: ctx.address,
      transactionId: item.transactionId,
      txID: hash,
      sequence: tx.Sequence,
      fee: tx.Fee,
      lastLedgerSequence: tx.LastLedgerSequence,
      signedBlobLen: signedBlob.length,
    });
    signed.push({
      signature: tx.TxnSignature as string,
      txData: signedBlob,
      txID: hash,
      transactionId: item.transactionId,
    });
  }

  return signed;
}
