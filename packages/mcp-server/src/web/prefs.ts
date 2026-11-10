/**
 * Wallet manager display preferences, next to the keystore. They live on disk
 * rather than in the browser because every manager start gets a new port, and
 * with it a fresh localStorage. Nothing here affects what the agent sees.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveKeystoreDir } from "../local-secrets.js";
import { restrictPrivateFile } from "../restrict-private-file.js";

export const PREFS_FILE = "manager-prefs.json";

export const TOKEN_SORTS = ["name", "amount", "value"] as const;
export type TokenSort = (typeof TOKEN_SORTS)[number];

export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export interface ManagerPrefs {
  /** `walletId` of the wallet the Home / Tokens / History screens show. */
  selectedWalletId?: string;
  /**
   * Per wallet id: token key (`network:assetId`) → shown or hidden. Only
   * deviations from the catalog default are stored.
   */
  tokenVisibility?: Record<string, Record<string, boolean>>;
  tokenSort?: TokenSort;
  showZeroBalances?: boolean;
  /** Unset: follow the OS colour scheme. */
  theme?: Theme;
}

function prefsPath(): string {
  return join(resolveKeystoreDir(), PREFS_FILE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readVisibility(raw: unknown): ManagerPrefs["tokenVisibility"] {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, Record<string, boolean>> = {};
  for (const [walletId, tokens] of Object.entries(raw)) {
    if (!isRecord(tokens)) continue;
    const flags: Record<string, boolean> = {};
    for (const [key, visible] of Object.entries(tokens)) {
      if (typeof visible === "boolean") flags[key] = visible;
    }
    out[walletId] = flags;
  }
  return out;
}

export function readPrefs(): ManagerPrefs {
  const path = prefsPath();
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const prefs: ManagerPrefs = {};
    if (typeof raw.selectedWalletId === "string") prefs.selectedWalletId = raw.selectedWalletId;
    const visibility = readVisibility(raw.tokenVisibility);
    if (visibility) prefs.tokenVisibility = visibility;
    if ((TOKEN_SORTS as readonly unknown[]).includes(raw.tokenSort)) prefs.tokenSort = raw.tokenSort as TokenSort;
    if (typeof raw.showZeroBalances === "boolean") prefs.showZeroBalances = raw.showZeroBalances;
    if ((THEMES as readonly unknown[]).includes(raw.theme)) prefs.theme = raw.theme as Theme;
    return prefs;
  } catch {
    return {};
  }
}

export function updatePrefs(patch: Partial<ManagerPrefs>): ManagerPrefs {
  const next = { ...readPrefs(), ...patch };
  const dir = resolveKeystoreDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = prefsPath();
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  restrictPrivateFile(path);
  return next;
}

/** Record a visibility override, or drop it when it matches the catalog default. */
export function setTokenVisibility(walletId: string, key: string, visible: boolean, isDefault: boolean): void {
  const all = { ...readPrefs().tokenVisibility };
  const flags = { ...all[walletId] };
  if (visible === isDefault) delete flags[key];
  else flags[key] = visible;
  if (Object.keys(flags).length > 0) all[walletId] = flags;
  else delete all[walletId];
  updatePrefs({ tokenVisibility: all });
}

export function forgetWalletPrefs(walletId: string): void {
  const prefs = readPrefs();
  if (!prefs.tokenVisibility?.[walletId]) return;
  const all = { ...prefs.tokenVisibility };
  delete all[walletId];
  updatePrefs({ tokenVisibility: all });
}
