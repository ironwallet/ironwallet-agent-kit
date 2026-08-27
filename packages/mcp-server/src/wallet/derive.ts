/**
 * BIP-39 / BIP-32 key derivation, seed-compatible with the IronWallet mobile
 * app. The app always derives account 0, address index 0 (no HD account
 * switching), so we do the same. Multiple wallets = multiple mnemonics, not
 * multiple indices.
 */

import { mnemonicToSeedSync, generateMnemonic, validateMnemonic } from "bip39";
import { HDKey } from "@scure/bip32";
import { computeAddress, getAddress, keccak256, SigningKey } from "ethers";
import bs58check from "bs58check";
import bs58 from "bs58";
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import * as btc from "@scure/btc-signer";
import { WalletContractV4 } from "@ton/ton";
import { deriveAddress as xrpDeriveAddress } from "ripple-keypairs";
import type { NetworkId } from "../config.js";
import { getConfig, isEvmNetwork } from "../config.js";

const EVM_PATH = "m/44'/60'/0'/0/0";
const TRON_PATH = "m/44'/195'/0'/0/0";
const BITCOIN_PATH = "m/84'/0'/0'/0/0";
const LITECOIN_PATH = "m/84'/2'/0'/0/0";
const DOGE_PATH = "m/44'/3'/0'/0/0";
const SOLANA_PATH = "m/44'/501'/0'";
const TON_PATH = "m/44'/607'/0'";
const XRP_PATH = "m/44'/144'/0'/0/0";

/** Litecoin mainnet params for @scure/btc-signer (P2WPKH bech32 `ltc1…`). */
export const LITECOIN_NETWORK = {
  bech32: "ltc",
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wif: 0xb0,
} as const;

/** Dogecoin mainnet params (legacy P2PKH `D…`; no SegWit). */
export const DOGE_NETWORK = {
  bech32: "doge",
  pubKeyHash: 0x1e,
  scriptHash: 0x16,
  wif: 0x9e,
} as const;

export interface DerivedKey {
  /** 0x-prefixed private key hex. Never leaves the process. */
  privateKey: string;
  /** Network-formatted address. */
  address: string;
}

/** Generate a new BIP-39 mnemonic (128 bits = 12 words, or 256 = 24). */
export function newMnemonic(words: 12 | 24 = 12): string {
  return generateMnemonic(words === 24 ? 256 : 128);
}

export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic.trim());
}

function seedFromMnemonic(mnemonic: string): Buffer {
  return mnemonicToSeedSync(mnemonic.trim());
}

function derivePrivateKey(mnemonic: string, path: string): string {
  const seed = seedFromMnemonic(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive(path);
  if (!child.privateKey) throw new Error(`No private key at path ${path}`);
  return "0x" + Buffer.from(child.privateKey).toString("hex");
}

/** EVM address (EIP-55 checksum). Shared across all EVM networks. */
export function deriveEvm(mnemonic: string): DerivedKey {
  const privateKey = derivePrivateKey(mnemonic, EVM_PATH);
  return { privateKey, address: computeAddress(privateKey) };
}

/**
 * Tron address: base58check of (0x41 || keccak256(uncompressedPubKey[1:])[-20:]).
 */
export function deriveTron(mnemonic: string): DerivedKey {
  const privateKey = derivePrivateKey(mnemonic, TRON_PATH);
  const uncompressed = SigningKey.computePublicKey(privateKey, false); // 0x04 + 64 bytes
  const pubBytes = Buffer.from(uncompressed.slice(2), "hex").subarray(1); // drop 0x04
  const hash = keccak256(pubBytes); // 0x + 32 bytes
  const addr20 = Buffer.from(hash.slice(2), "hex").subarray(12); // last 20 bytes
  const payload = Buffer.concat([Buffer.from([0x41]), addr20]);
  return { privateKey, address: bs58check.encode(payload) };
}

/**
 * SLIP-0010 ed25519 key derivation. All path segments must be hardened (this is
 * how Solana/TON wallets derive: m/44'/501'/0' and m/44'/607'/0').
 */
function deriveEd25519PrivateKey(mnemonic: string, path: string): Uint8Array {
  const seed = seedFromMnemonic(mnemonic);
  let I = hmac(sha512, new TextEncoder().encode("ed25519 seed"), seed);
  let key = I.slice(0, 32);
  let chainCode = I.slice(32);

  const segments = path
    .split("/")
    .slice(1) // drop leading "m"
    .map((s) => {
      if (!s.endsWith("'")) {
        throw new Error(`ed25519 path segment must be hardened: ${s}`);
      }
      return (parseInt(s.slice(0, -1), 10) | 0x80000000) >>> 0;
    });

  for (const index of segments) {
    const data = new Uint8Array(1 + 32 + 4);
    data[0] = 0x00;
    data.set(key, 1);
    // ser32(index), big-endian
    data[33] = (index >>> 24) & 0xff;
    data[34] = (index >>> 16) & 0xff;
    data[35] = (index >>> 8) & 0xff;
    data[36] = index & 0xff;
    I = hmac(sha512, chainCode, data);
    key = I.slice(0, 32);
    chainCode = I.slice(32);
  }
  return key;
}

/** Bitcoin BIP-84 native SegWit (P2WPKH). Address prefix bc1 / tb1 by network. */
export function deriveBitcoin(mnemonic: string, testnet: boolean): DerivedKey {
  const seed = seedFromMnemonic(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive(BITCOIN_PATH);
  if (!child.privateKey || !child.publicKey) {
    throw new Error("No Bitcoin key derived.");
  }
  const network = testnet ? btc.TEST_NETWORK : btc.NETWORK;
  const p2wpkh = btc.p2wpkh(child.publicKey, network);
  if (!p2wpkh.address) throw new Error("Failed to build Bitcoin address.");
  return {
    privateKey: "0x" + Buffer.from(child.privateKey).toString("hex"),
    address: p2wpkh.address,
  };
}

/** Litecoin BIP-84 native SegWit (P2WPKH). Mainnet `ltc1q…` (hd-wallet MainNet). */
export function deriveLitecoin(mnemonic: string): DerivedKey {
  const seed = seedFromMnemonic(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive(LITECOIN_PATH);
  if (!child.privateKey || !child.publicKey) {
    throw new Error("No Litecoin key derived.");
  }
  const p2wpkh = btc.p2wpkh(child.publicKey, LITECOIN_NETWORK);
  if (!p2wpkh.address) throw new Error("Failed to build Litecoin address.");
  return {
    privateKey: "0x" + Buffer.from(child.privateKey).toString("hex"),
    address: p2wpkh.address,
  };
}

/** Dogecoin BIP-44 legacy P2PKH. Mainnet `D…` (hd-wallet MainNet, no SegWit). */
export function deriveDoge(mnemonic: string): DerivedKey {
  const seed = seedFromMnemonic(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive(DOGE_PATH);
  if (!child.privateKey || !child.publicKey) {
    throw new Error("No Dogecoin key derived.");
  }
  const p2pkh = btc.p2pkh(child.publicKey, DOGE_NETWORK);
  if (!p2pkh.address) throw new Error("Failed to build Dogecoin address.");
  return {
    privateKey: "0x" + Buffer.from(child.privateKey).toString("hex"),
    address: p2pkh.address,
  };
}

/** Solana: SLIP-0010 ed25519, base58 public key as the address. */
export function deriveSolana(mnemonic: string): DerivedKey {
  const priv = deriveEd25519PrivateKey(mnemonic, SOLANA_PATH);
  const pub = ed25519.getPublicKey(priv);
  return {
    privateKey: "0x" + Buffer.from(priv).toString("hex"),
    address: bs58.encode(pub),
  };
}

/** TON: ed25519 key -> Wallet v4R2 on workchain 0, non-bounceable (UQ...). */
export function deriveTon(mnemonic: string): DerivedKey {
  const priv = deriveEd25519PrivateKey(mnemonic, TON_PATH);
  const pub = ed25519.getPublicKey(priv);
  const wallet = WalletContractV4.create({
    workchain: 0,
    publicKey: Buffer.from(pub),
  });
  const address = wallet.address.toString({
    bounceable: false,
    urlSafe: true,
    testOnly: false,
  });
  return { privateKey: "0x" + Buffer.from(priv).toString("hex"), address };
}

/** XRP: secp256k1 BIP-44, classic r-address via the XRPL codec. */
export function deriveXrp(mnemonic: string): DerivedKey {
  const privateKey = derivePrivateKey(mnemonic, XRP_PATH);
  const pubCompressed = SigningKey.computePublicKey(privateKey, true).slice(2).toUpperCase();
  const address = xrpDeriveAddress(pubCompressed);
  return { privateKey, address };
}

export function deriveKey(mnemonic: string, network: NetworkId): DerivedKey {
  switch (network) {
    case "tron":
      return deriveTron(mnemonic);
    case "bitcoin":
      return deriveBitcoin(mnemonic, getConfig().bitcoinTestnet);
    case "litecoin":
      return deriveLitecoin(mnemonic);
    case "doge":
      return deriveDoge(mnemonic);
    case "solana":
      return deriveSolana(mnemonic);
    case "ton":
      return deriveTon(mnemonic);
    case "xrp":
      return deriveXrp(mnemonic);
    default:
      return deriveEvm(mnemonic);
  }
}

/** All addresses for a mnemonic, keyed by network. Safe to expose (no keys). */
export function deriveAddresses(mnemonic: string): Record<string, string> {
  const evm = deriveEvm(mnemonic).address;
  return {
    ethereum: evm,
    bsc: evm,
    polygon: evm,
    base: evm,
    arbitrum: evm,
    optimism: evm,
    avalanche: evm,
    tron: deriveTron(mnemonic).address,
    bitcoin: deriveBitcoin(mnemonic, getConfig().bitcoinTestnet).address,
    litecoin: deriveLitecoin(mnemonic).address,
    doge: deriveDoge(mnemonic).address,
    solana: deriveSolana(mnemonic).address,
    ton: deriveTon(mnemonic).address,
    xrp: deriveXrp(mnemonic).address,
  };
}

/** Normalize an EVM address to checksum form; pass through non-EVM. */
export function normalizeAddress(network: NetworkId, address: string): string {
  return isEvmNetwork(network) ? getAddress(address) : address;
}
