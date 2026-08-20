/**
 * TON signing — matches mobile `ton_net_api_client` (IR-673 RelayV2 path):
 *
 *   Relay estimate returns unsigned wallet-transfer bodies as BoC in `txData`
 *   (hex or base64). The client ed25519-signs each cell hash, wraps the signed
 *   body in an external message (with wallet init when seqno == 0), and puts the
 *   external-message BoC hex into both `signature` and `txData` of the forward
 *   payload.
 *
 * Estimate must include `fromPublicKey` (32-byte ed25519 pubkey hex) — same as
 * mobile `RelayV2EstimateRequest.fromPublicKey` for NetType.ton.
 *
 * `sendTon` remains as a direct TonCenter broadcast fallback (pre-relay path).
 */

import {
  Address,
  WalletContractV4,
  beginCell,
  Cell,
  external,
  storeMessage,
  internal,
  toNano,
  SendMode,
  TonClient,
} from "@ton/ton";
import { sign } from "@ton/crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { getConfig } from "../config.js";
import { deriveTon } from "../wallet/derive.js";
import { logError, logInfo } from "../log.js";
import type { SignContext, SignedTransaction, TransactionToSign } from "./types.js";

function hexToBytes(h: string): Buffer {
  return Buffer.from(h.replace(/^0x/, ""), "hex");
}

function isHexString(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(value);
}

function decodeRelayPayload(txData: string): Buffer {
  let normalized = txData.trim();
  if (normalized.startsWith("0x") || normalized.startsWith("0X")) {
    normalized = normalized.slice(2);
  }
  if (isHexString(normalized)) {
    return Buffer.from(normalized, "hex");
  }
  return Buffer.from(normalized, "base64");
}

function parseRelayTxDataCell(txData: string): Cell {
  const bytes = decodeRelayPayload(txData);
  const cells = Cell.fromBoc(bytes);
  if (cells.length === 0) {
    throw new Error("Invalid TON relay txData: empty BoC");
  }
  return cells[0]!;
}

/** 32-byte ed25519 public key hex (no 0x), for relay estimate `fromPublicKey`. */
export function tonPublicKeyHex(mnemonic: string): string {
  const derived = deriveTon(mnemonic);
  const seed = hexToBytes(derived.privateKey);
  return Buffer.from(ed25519.getPublicKey(seed)).toString("hex");
}

function secretKeyFromSeed(seed: Buffer): Buffer {
  const pub = Buffer.from(ed25519.getPublicKey(seed));
  return Buffer.concat([seed, pub]);
}

/**
 * Sign relay `transactionsToSign` the same way as mobile
 * `_signRelayWalletTransfer`: signature || unsigned body → external message BoC.
 */
export function signTon(
  ctx: SignContext,
  txs: TransactionToSign[],
): SignedTransaction[] {
  const seed = hexToBytes(ctx.privateKey);
  const secretKey = secretKeyFromSeed(seed);
  const publicKey = Buffer.from(ed25519.getPublicKey(seed));
  const wallet = WalletContractV4.create({ workchain: 0, publicKey });
  const destination = Address.parse(ctx.address);

  const signed: SignedTransaction[] = [];
  for (const tx of txs) {
    if (!tx.txData) continue;

    const unsignedCell = parseRelayTxDataCell(tx.txData);
    const signature = sign(unsignedCell.hash(), secretKey);
    const signedBody = beginCell()
      .storeBuffer(signature)
      .storeSlice(unsignedCell.beginParse())
      .endCell();

    const unsignedSlice = unsignedCell.beginParse();
    unsignedSlice.loadUint(32); // wallet id
    unsignedSlice.loadUint(32); // valid until
    const seqno = unsignedSlice.loadUint(32);

    const externalMessage =
      seqno === 0
        ? external({
            to: destination,
            init: wallet.init,
            body: signedBody,
          })
        : external({
            to: destination,
            body: signedBody,
          });

    const externalBocHex = beginCell()
      .store(storeMessage(externalMessage))
      .endCell()
      .toBoc()
      .toString("hex");

    signed.push({
      txID: tx.txId ?? "",
      signature: externalBocHex,
      txData: externalBocHex,
      transactionId: tx.transactionId,
    });
  }
  return signed;
}

export interface TonSendParams {
  to: string;
  /** Amount in TON (decimal string). */
  amount: string;
  memo?: string;
}

export interface TonSendResult {
  txHash: string;
}

/** Direct TonCenter broadcast (legacy / fallback; mobile still keeps this path). */
export async function sendTon(
  mnemonic: string,
  params: TonSendParams,
): Promise<TonSendResult> {
  const started = Date.now();
  const derived = deriveTon(mnemonic);
  const seed = hexToBytes(derived.privateKey);
  const secretKey = secretKeyFromSeed(seed);
  const pub = Buffer.from(ed25519.getPublicKey(seed));
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: pub });

  const cfg = getConfig();
  const apiKey = process.env.IW_TON_API_KEY?.trim();
  const endpoint = `${cfg.tonApiUrl}/jsonRPC`;
  logInfo("ton.send.start", {
    from: derived.address,
    to: params.to,
    amount: params.amount,
    hasMemo: Boolean(params.memo),
    endpoint,
    hasApiKey: Boolean(apiKey),
  });

  try {
    const client = new TonClient({
      endpoint,
      ...(apiKey ? { apiKey } : {}),
    });

    const opened = client.open(wallet);
    const seqno = await opened.getSeqno();
    logInfo("ton.send.seqno", { from: derived.address, seqno });

    const transfer = wallet.createTransfer({
      seqno,
      secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      messages: [
        internal({
          to: Address.parse(params.to),
          value: toNano(params.amount),
          bounce: false,
          body: params.memo && params.memo.length > 0 ? params.memo : undefined,
        }),
      ],
    });

    await opened.send(transfer);
    const txHash = Buffer.from(transfer.hash()).toString("base64");
    logInfo("ton.send.ok", {
      from: derived.address,
      to: params.to,
      amount: params.amount,
      seqno,
      txHash,
      elapsedMs: Date.now() - started,
    });
    return { txHash };
  } catch (e) {
    logError("ton.send.fail", e, {
      from: derived.address,
      to: params.to,
      amount: params.amount,
      endpoint,
      elapsedMs: Date.now() - started,
    });
    throw e;
  }
}
