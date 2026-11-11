/** `/api/wallets*` and `/api/prefs`: list, create, import, rename, delete, backup, selection. */

import type { IncomingMessage } from "node:http";
import {
  createNamedWallet,
  getEntryById,
  importWallet,
  KeystoreInputError,
  loadKeystore,
  removeWallet,
  renameWallet,
  revealMnemonic,
  verifyBackup,
  walletId,
} from "../keystore/store.js";
import type { WalletEntry } from "../keystore/types.js";
import { logInfo } from "../log.js";
import { requirePassphrase } from "../passphrase.js";
import type {
  DeleteWalletResponse,
  MnemonicResponse,
  PrefsResponse,
  WalletResponse,
  WalletsResponse,
  WalletSummary,
} from "./contract.js";
import { HttpError, readJson, requireConsent, stringField } from "./api-util.js";
import {
  forgetWalletPrefs,
  readPrefs,
  THEMES,
  TOKEN_SORTS,
  updatePrefs,
  type ManagerPrefs,
  type Theme,
  type TokenSort,
} from "./prefs.js";

function summary(entry: WalletEntry): WalletSummary {
  return {
    id: walletId(entry),
    name: entry.name,
    backedUp: entry.backedUp,
    createdAt: entry.createdAt,
    addresses: entry.addresses,
  };
}

export function findWallet(id: string): WalletEntry {
  const entry = getEntryById(id);
  if (!entry) throw new HttpError(404, "not_found", "This wallet no longer exists.");
  return entry;
}

/** Stored selection if that wallet still exists, else the first wallet. */
function selectedId(ids: string[]): string | null {
  const stored = readPrefs().selectedWalletId;
  return stored && ids.includes(stored) ? stored : (ids[0] ?? null);
}

/** Keystore input errors become 400 with their (phrase-free) message. */
function asInput<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof KeystoreInputError) throw new HttpError(400, "bad_request", e.message);
    throw e;
  }
}

export function listWallets(): WalletsResponse {
  const wallets = loadKeystore().wallets.map(summary);
  return { wallets, selectedId: selectedId(wallets.map((w) => w.id)) };
}

export async function createWallet(req: IncomingMessage): Promise<WalletResponse> {
  requireConsent();
  const name = stringField(await readJson(req), "name");
  const entry = asInput(() => createNamedWallet(name, requirePassphrase()));
  const wallet = summary(entry);
  updatePrefs({ selectedWalletId: wallet.id });
  logInfo("manager.create.ok", { name: wallet.name, addresses: wallet.addresses });
  return { wallet };
}

export async function importWalletFromPhrase(req: IncomingMessage): Promise<WalletResponse> {
  requireConsent();
  const body = await readJson(req);
  const name = stringField(body, "name");
  const mnemonic = stringField(body, "mnemonic");
  const entry = asInput(() => importWallet(mnemonic, requirePassphrase(), name));
  const wallet = summary(entry);
  updatePrefs({ selectedWalletId: wallet.id });
  logInfo("manager.import.ok", { name: wallet.name, addresses: wallet.addresses });
  return { wallet };
}

export async function renameWalletById(req: IncomingMessage, id: string): Promise<WalletResponse> {
  requireConsent();
  const name = stringField(await readJson(req), "name");
  const entry = findWallet(id);
  return { wallet: summary(asInput(() => renameWallet(entry.name, name))) };
}

export async function deleteWalletById(req: IncomingMessage, id: string): Promise<DeleteWalletResponse> {
  requireConsent();
  const body = await readJson(req);
  if (body.acknowledged !== true) {
    throw new HttpError(400, "bad_request", "Confirm that your recovery phrase is saved.");
  }
  const entry = findWallet(id);
  removeWallet(entry.name);
  forgetWalletPrefs(id);
  logInfo("manager.delete.ok", { name: entry.name, backedUp: entry.backedUp });
  return { deleted: true };
}

export function walletMnemonic(id: string): MnemonicResponse {
  const entry = findWallet(id);
  const words = revealMnemonic(entry.name, requirePassphrase()).split(" ");
  logInfo("manager.mnemonic.shown", { name: entry.name });
  return { words };
}

export async function verifyWalletBackup(req: IncomingMessage, id: string): Promise<WalletResponse> {
  const { words } = await readJson(req);
  if (!Array.isArray(words) || words.length > 24 || !words.every((w) => typeof w === "string")) {
    throw new HttpError(400, "bad_request", '"words" must be a list of words.');
  }
  const entry = findWallet(id);
  if (!verifyBackup(entry.name, words, requirePassphrase())) {
    throw new HttpError(400, "backup_mismatch", "The words are not in the right order. Try again.");
  }
  return { wallet: summary(findWallet(id)) };
}

export function getPrefs(): PrefsResponse {
  const prefs = readPrefs();
  return {
    selectedWalletId: listWallets().selectedId,
    tokenSort: prefs.tokenSort ?? "value",
    showZeroBalances: prefs.showZeroBalances ?? true,
    theme: prefs.theme ?? null,
  };
}

export async function patchPrefs(req: IncomingMessage): Promise<PrefsResponse> {
  const body = await readJson(req);
  const patch: Partial<ManagerPrefs> = {};
  if (body.selectedWalletId !== undefined) {
    const id = stringField(body, "selectedWalletId");
    findWallet(id);
    patch.selectedWalletId = id;
  }
  if (body.tokenSort !== undefined) {
    if (!(TOKEN_SORTS as readonly unknown[]).includes(body.tokenSort)) {
      throw new HttpError(400, "bad_request", `"tokenSort" must be one of ${TOKEN_SORTS.join(", ")}.`);
    }
    patch.tokenSort = body.tokenSort as TokenSort;
  }
  if (body.showZeroBalances !== undefined) {
    if (typeof body.showZeroBalances !== "boolean") {
      throw new HttpError(400, "bad_request", '"showZeroBalances" must be true or false.');
    }
    patch.showZeroBalances = body.showZeroBalances;
  }
  if (body.theme !== undefined) {
    if (!(THEMES as readonly unknown[]).includes(body.theme)) {
      throw new HttpError(400, "bad_request", `"theme" must be one of ${THEMES.join(", ")}.`);
    }
    patch.theme = body.theme as Theme;
  }
  if (Object.keys(patch).length > 0) updatePrefs(patch);
  return getPrefs();
}
