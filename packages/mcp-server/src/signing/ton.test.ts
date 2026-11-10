import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { Address, beginCell, Cell, loadMessage, WalletContractV4 } from "@ton/ton";
import { sideToJson } from "../api/swap.js";
import { mapSigned } from "./swap.js";
import { signTon } from "./ton.js";

const seed = randomBytes(32);
const publicKey = Buffer.from(ed25519.getPublicKey(seed));
const wallet = WalletContractV4.create({ workchain: 0, publicKey });
const ctx = { privateKey: `0x${seed.toString("hex")}`, address: wallet.address.toString() };

function unsignedBody(seqno: number): string {
  return beginCell()
    .storeUint(698983191, 32) // subwallet id
    .storeUint(1_900_000_000, 32) // valid until
    .storeUint(seqno, 32)
    .storeUint(0, 8) // op: simple send
    .endCell()
    .toBoc()
    .toString("hex");
}

/** Same cell as wallet-service `WalletV4R2Utils.NormalizeHash`, rebuilt from the parsed BoC. */
function serverNormalizedHash(externalBocHex: string): { hash: string; hasInit: boolean } {
  const message = loadMessage(Cell.fromBoc(Buffer.from(externalBocHex, "hex"))[0]!.beginParse());
  assert.equal(message.info.type, "external-in");
  const hash = beginCell()
    .storeUint(2, 2)
    .storeUint(0, 2)
    .storeAddress(message.info.dest as Address)
    .storeUint(0, 4)
    .storeBit(false)
    .storeBit(true)
    .storeRef(message.body)
    .endCell()
    .hash()
    .toString("hex");
  return { hash, hasInit: Boolean(message.init) };
}

test("signTon puts the normalized external message hash into txID", () => {
  const [signed] = signTon(ctx, [{ txId: "", txData: unsignedBody(7) }]);
  assert.match(signed!.txID, /^[0-9a-f]{64}$/);
  const server = serverNormalizedHash(signed!.txData);
  assert.equal(server.hasInit, false);
  assert.equal(signed!.txID, server.hash);
});

test("state init on the first message (seqno 0) does not change the hash", () => {
  const [signed] = signTon(ctx, [{ txId: "", txData: unsignedBody(0) }]);
  const server = serverNormalizedHash(signed!.txData);
  assert.equal(server.hasInit, true);
  assert.equal(signed!.txID, server.hash);
});

test("TON swap execute payload carries the hash in txHash and txId", () => {
  const original = [
    { type: "TokenFeePayment", txId: "", txData: unsignedBody(0) },
    { type: "MainTransfer", txId: "", txData: unsignedBody(1) },
  ];
  const signed = signTon(ctx, original);
  const mapped = mapSigned("ton", original, signed);
  assert.equal(mapped.length, 2);
  mapped.forEach((dto, i) => {
    assert.equal(dto.type, original[i]!.type);
    assert.equal(dto.txHash, signed[i]!.txID);
    assert.equal(dto.txId, signed[i]!.txID);
    assert.equal(dto.signedTx, signed[i]!.signature);
    assert.equal(dto.txData, signed[i]!.signature);
  });
  assert.notEqual(mapped[0]!.txHash, mapped[1]!.txHash);
});

test("swap side sends publicKey only when it is set", () => {
  const asset = { network: "ton", symbol: "usdt", address: "EQCxE6", decimals: 6 };
  const key = publicKey.toString("hex");
  assert.equal(sideToJson({ asset, address: ctx.address, amount: "10", publicKey: key }).publicKey, key);
  assert.equal("publicKey" in sideToJson({ asset, address: ctx.address, amount: "10" }), false);
});
