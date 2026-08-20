/**
 * Keystore persistence: reads/writes the encrypted keystore file and provides
 * seed generation/import. Mnemonics are held in memory only transiently during
 * signing; they are never returned to callers of these functions except the
 * local browser wallet manager.
 */

import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { getConfig } from "../config.js";
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

function saveKeystore(ks: KeystoreFile): void {
  ensureDir();
  const path = keystorePath();
  writeFileSync(path, JSON.stringify(ks, null, 2), { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // best effort on platforms without POSIX perms
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
  /** Only populated for the local browser manager, never for the agent-facing tool. */
  mnemonic?: string;
}

/**
 * Create N brand-new wallets. Returns names + addresses. The mnemonic is only
 * echoed back when `revealMnemonic` is true (wallet manager), never for the
 * MCP tool path.
 */
export function createWallets(
  count: number,
  passphrase: string,
  opts: { namePrefix?: string; revealMnemonic?: boolean } = {},
): CreatedWallet[] {
  if (count < 1 || count > 50) {
    throw new Error("count must be between 1 and 50.");
  }
  logInfo("keystore.create_wallets.start", {
    count,
    namePrefix: opts.namePrefix,
    revealMnemonic: Boolean(opts.revealMnemonic),
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
    created.push({
      name,
      addresses,
      mnemonic: opts.revealMnemonic ? mnemonic : undefined,
    });
  }
  saveKeystore(ks);
  logInfo("keystore.create_wallets.ok", {
    created: created.map((c) => ({ name: c.name, addresses: c.addresses })),
  });
  return created;
}

/** Import an existing mnemonic under a name. */
export function importWallet(
  mnemonic: string,
  passphrase: string,
  name?: string,
): CreatedWallet {
  const trimmed = mnemonic.trim();
  if (!isValidMnemonic(trimmed)) {
    logError("keystore.import.fail", new Error("Invalid BIP-39 mnemonic."), {
      requestedName: name,
    });
    throw new Error("Invalid BIP-39 mnemonic.");
  }
  const ks = loadKeystore();
  const existing = new Set(ks.wallets.map((w) => w.name));
  const finalName = uniqueName(name ?? "imported", existing);
  const addresses = deriveAddresses(trimmed);
  const entry: WalletEntry = {
    name: finalName,
    encSeed: encryptSecret(trimmed, passphrase),
    addresses,
    backedUp: true, // user already has these words
    createdAt: new Date().toISOString(),
  };
  ks.wallets.push(entry);
  saveKeystore(ks);
  logInfo("keystore.import.ok", { name: finalName, addresses });
  return { name: finalName, addresses };
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
