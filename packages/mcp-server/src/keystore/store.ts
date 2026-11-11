/**
 * Keystore persistence: reads/writes the encrypted keystore file and provides
 * seed generation/import. Mnemonics are held in memory only transiently during
 * signing; they are never returned to callers of these functions except the
 * local browser wallet manager.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { getConfig } from "../config.js";
import { restrictPrivateFile } from "../restrict-private-file.js";
import { encryptSecret, decryptSecret } from "./crypto.js";
import type { KeystoreFile, WalletEntry, WalletPolicy } from "./types.js";
import {
  deriveAddresses,
  newMnemonic,
  isValidMnemonic,
} from "../wallet/derive.js";
import { logDebug, logError, logInfo } from "../log.js";

function keystorePath(): string {
  return join(getConfig().keystoreDir, "keystore.json");
}

function ensureDir(): void {
  const dir = getConfig().keystoreDir;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function loadKeystore(): KeystoreFile {
  const path = keystorePath();
  if (!existsSync(path)) {
    logDebug("keystore.load", { path, exists: false, walletCount: 0 });
    return { version: 1, wallets: [] };
  }
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as KeystoreFile;
  if (parsed.version !== 1) {
    throw new Error(`Unsupported keystore version: ${parsed.version}`);
  }
  logDebug("keystore.load", {
    path,
    exists: true,
    walletCount: parsed.wallets.length,
    names: parsed.wallets.map((w) => w.name),
  });
  return parsed;
}

/**
 * Atomic save: write a sibling temp file, fsync, then rename over the live
 * keystore. A crash mid-write must never leave a truncated keystore.json —
 * that file is the only copy of every seed on this machine. The rename keeps
 * the owner-only permissions applied to the temp file. If keystore.json is a
 * symlink, the real target is replaced, not the link. On any failure the temp
 * file is removed and the previous keystore stays as it was.
 */
function saveKeystore(ks: KeystoreFile): void {
  ensureDir();
  const configured = keystorePath();
  const path = existsSync(configured) ? realpathSync(configured) : configured;
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    const fd = openSync(tmp, "w", 0o600);
    try {
      writeSync(fd, JSON.stringify(ks, null, 2));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    restrictPrivateFile(tmp);
    renameSync(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      // temp file was never created or is already gone
    }
    throw e;
  }
  logInfo("keystore.save", {
    path,
    walletCount: ks.wallets.length,
    names: ks.wallets.map((w) => w.name),
  });
}

export function walletNames(): string[] {
  return loadKeystore().wallets.map((w) => w.name);
}

export function getEntry(name: string): WalletEntry | undefined {
  return loadKeystore().wallets.find((w) => w.name === name);
}

/**
 * Handle for the wallet manager UI. Derived from the encrypted seed blob (fresh
 * salt per wallet), so it needs no stored field, survives renames, and reveals
 * nothing about the seed.
 */
export function walletId(entry: Pick<WalletEntry, "encSeed">): string {
  return createHash("sha256").update(entry.encSeed).digest("hex").slice(0, 16);
}

export function getEntryById(id: string): WalletEntry | undefined {
  return loadKeystore().wallets.find((w) => walletId(w) === id);
}

/** A rejected user input (name, phrase). The message is safe to show and never echoes a phrase. */
export class KeystoreInputError extends Error {}

export const WALLET_NAME_MAX = 40;

/** Trim and validate a name typed in the manager. */
export function normalizeWalletName(raw: string): string {
  const trimmed = raw.trim();
  if (/\p{Cc}/u.test(trimmed)) throw new KeystoreInputError("The name contains invalid characters.");
  const name = trimmed.replace(/ +/g, " ");
  if (!name) throw new KeystoreInputError("Enter a wallet name.");
  if (name.length > WALLET_NAME_MAX) {
    throw new KeystoreInputError(`Use at most ${WALLET_NAME_MAX} characters.`);
  }
  return name;
}

/** Names are what the agent passes as `wallet`, so they must not differ only by case. */
function assertNameFree(ks: KeystoreFile, name: string, except?: WalletEntry): void {
  const lower = name.toLowerCase();
  const taken = ks.wallets.find((w) => w !== except && w.name.toLowerCase() === lower);
  if (taken) throw new KeystoreInputError(`A wallet named "${taken.name}" already exists.`);
}

/**
 * Resolve which wallet to use. If `name` is given it must exist. If omitted and
 * exactly one wallet exists, that one is used. Otherwise an error is thrown.
 */
export function resolveEntry(name?: string): WalletEntry {
  const ks = loadKeystore();
  if (name) {
    const found = ks.wallets.find((w) => w.name === name);
    if (!found) throw new Error(`Wallet "${name}" not found.`);
    return found;
  }
  if (ks.wallets.length === 1) return ks.wallets[0];
  if (ks.wallets.length === 0) {
    throw new Error(
      "No wallets found. Create one with the create_wallets tool or open_wallet_manager.",
    );
  }
  throw new Error(
    `Multiple wallets exist (${ks.wallets
      .map((w) => w.name)
      .join(", ")}). Specify which one with the "wallet" parameter.`,
  );
}

function uniqueName(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export interface CreatedWallet {
  name: string;
  addresses: Record<string, string>;
}

/** Create N brand-new wallets. Returns names + addresses, never the mnemonic. */
export function createWallets(
  count: number,
  passphrase: string,
  opts: { namePrefix?: string } = {},
): CreatedWallet[] {
  if (count < 1 || count > 50) {
    throw new Error("count must be between 1 and 50.");
  }
  logInfo("keystore.create_wallets.start", {
    count,
    namePrefix: opts.namePrefix,
  });
  const ks = loadKeystore();
  const existing = new Set(ks.wallets.map((w) => w.name));
  const prefix = opts.namePrefix ?? "wallet";
  const created: CreatedWallet[] = [];

  for (let i = 0; i < count; i++) {
    const mnemonic = newMnemonic(12);
    const addresses = deriveAddresses(mnemonic);
    const name = uniqueName(
      count === 1 && opts.namePrefix ? prefix : `${prefix}-${existing.size + 1}`,
      existing,
    );
    existing.add(name);
    const entry: WalletEntry = {
      name,
      encSeed: encryptSecret(mnemonic, passphrase),
      addresses,
      backedUp: false,
      createdAt: new Date().toISOString(),
    };
    ks.wallets.push(entry);
    created.push({ name, addresses });
  }
  saveKeystore(ks);
  logInfo("keystore.create_wallets.ok", {
    created: created.map((c) => ({ name: c.name, addresses: c.addresses })),
  });
  return created;
}

/** Wallet manager: one new wallet under exactly the name the user typed. */
export function createNamedWallet(rawName: string, passphrase: string): WalletEntry {
  const name = normalizeWalletName(rawName);
  const ks = loadKeystore();
  assertNameFree(ks, name);
  const mnemonic = newMnemonic(12);
  const entry: WalletEntry = {
    name,
    encSeed: encryptSecret(mnemonic, passphrase),
    addresses: deriveAddresses(mnemonic),
    backedUp: false,
    createdAt: new Date().toISOString(),
  };
  ks.wallets.push(entry);
  saveKeystore(ks);
  logInfo("keystore.create_named.ok", { name, addresses: entry.addresses });
  return entry;
}

/** Import an existing mnemonic under exactly `name`. The same seed cannot be imported twice. */
export function importWallet(mnemonic: string, passphrase: string, rawName: string): WalletEntry {
  const name = normalizeWalletName(rawName);
  const phrase = mnemonic.trim().toLowerCase().split(/\s+/).join(" ");
  if (!isValidMnemonic(phrase)) {
    logError("keystore.import.fail", new Error("Invalid BIP-39 mnemonic."), { requestedName: name });
    throw new KeystoreInputError("This is not a valid recovery phrase. Check the words and their order.");
  }
  const ks = loadKeystore();
  assertNameFree(ks, name);
  const addresses = deriveAddresses(phrase);
  const twin = ks.wallets.find((w) => w.addresses.ethereum === addresses.ethereum);
  if (twin) throw new KeystoreInputError(`This wallet is already imported as "${twin.name}".`);
  const entry: WalletEntry = {
    name,
    encSeed: encryptSecret(phrase, passphrase),
    addresses,
    backedUp: true, // user already has these words
    createdAt: new Date().toISOString(),
  };
  ks.wallets.push(entry);
  saveKeystore(ks);
  logInfo("keystore.import.ok", { name, addresses });
  return entry;
}

export function renameWallet(name: string, rawNewName: string): WalletEntry {
  const newName = normalizeWalletName(rawNewName);
  const ks = loadKeystore();
  const entry = ks.wallets.find((w) => w.name === name);
  if (!entry) throw new Error(`Wallet "${name}" not found.`);
  if (entry.name === newName) return entry;
  assertNameFree(ks, newName, entry);
  entry.name = newName;
  saveKeystore(ks);
  logInfo("keystore.rename.ok", { from: name, to: newName });
  return entry;
}

/** Decrypt and return a wallet's mnemonic. CLI/backup use only. */
export function revealMnemonic(name: string, passphrase: string): string {
  const entry = getEntry(name);
  if (!entry) throw new Error(`Wallet "${name}" not found.`);
  return decryptSecret(entry.encSeed, passphrase);
}

/** Decrypt a wallet's mnemonic for internal signing. Never expose the result. */
export function unlockMnemonic(entry: WalletEntry, passphrase: string): string {
  return decryptSecret(entry.encSeed, passphrase);
}

/**
 * Fill in any newly supported network addresses missing from an older keystore
 * entry (e.g. litecoin/doge added after the wallet was created). Persists when
 * something was missing.
 */
export function syncAddresses(entry: WalletEntry, mnemonic: string): WalletEntry {
  const fresh = deriveAddresses(mnemonic);
  let changed = false;
  const merged = { ...entry.addresses };
  for (const [net, addr] of Object.entries(fresh)) {
    if (!merged[net]) {
      merged[net] = addr;
      changed = true;
    }
  }
  if (!changed) return entry;
  const ks = loadKeystore();
  const stored = ks.wallets.find((w) => w.name === entry.name);
  if (!stored) return { ...entry, addresses: merged };
  stored.addresses = merged;
  saveKeystore(ks);
  logInfo("keystore.sync_addresses", {
    name: entry.name,
    added: Object.keys(fresh).filter((n) => !entry.addresses[n]),
  });
  return { ...entry, addresses: merged };
}

/**
 * Check the words the user put back in order against the stored mnemonic and,
 * on a match, mark the wallet as backed up. Returns whether they matched.
 */
export function verifyBackup(name: string, words: string[], passphrase: string): boolean {
  const entry = getEntry(name);
  if (!entry) throw new Error(`Wallet "${name}" not found.`);
  const expected = decryptSecret(entry.encSeed, passphrase).split(" ");
  const given = words.map((w) => w.trim().toLowerCase());
  const match = given.length === expected.length && given.every((w, i) => w === expected[i]);
  logInfo("keystore.verify_backup", { name, match });
  if (match && !entry.backedUp) markBackedUp(name);
  return match;
}

export function markBackedUp(name: string): void {
  const ks = loadKeystore();
  const entry = ks.wallets.find((w) => w.name === name);
  if (!entry) throw new Error(`Wallet "${name}" not found.`);
  entry.backedUp = true;
  saveKeystore(ks);
}

export function removeWallet(name: string): void {
  const ks = loadKeystore();
  const before = ks.wallets.length;
  ks.wallets = ks.wallets.filter((w) => w.name !== name);
  if (ks.wallets.length === before) throw new Error(`Wallet "${name}" not found.`);
  saveKeystore(ks);
  logInfo("keystore.remove.ok", { name, remaining: ks.wallets.length });
}

export function setPolicy(name: string, policy: WalletPolicy): void {
  const ks = loadKeystore();
  const entry = ks.wallets.find((w) => w.name === name);
  if (!entry) throw new Error(`Wallet "${name}" not found.`);
  entry.policy = policy;
  saveKeystore(ks);
}
