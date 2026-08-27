import type { NetworkId } from "../config.js";

/** Per-wallet spending policy. Enforced only when `enabled` is true. */
export interface WalletPolicy {
  enabled: boolean;
  /** If true, send_transfer and execute_swap are rejected. */
  readOnly?: boolean;
  /**
   * Max USD value per send_transfer or execute_swap (decimal string, e.g. "50").
   * Converted at the moment of the operation via the rates backend; if the rate
   * is unavailable the operation is rejected (fail closed).
   */
  maxPerTxUsd?: string;
  /**
   * Allowed transfer destinations. Empty/undefined = no whitelist.
   * Applies to send_transfer only; execute_swap is exempt because the bought
   * asset is always paid out to the wallet's own keystore address.
   */
  allowedRecipients?: string[];
}

/** An encrypted seed record. The mnemonic is never stored in clear text. */
export interface WalletEntry {
  name: string;
  /** Encrypted mnemonic blob (see keystore/crypto.ts EncryptedBlob JSON). */
  encSeed: string;
  /** Public addresses per network. Safe to read without the passphrase. */
  addresses: Record<string, string>;
  /** Whether the user confirmed they backed up the mnemonic. */
  backedUp: boolean;
  createdAt: string;
  policy?: WalletPolicy;
}

export interface KeystoreFile {
  version: 1;
  wallets: WalletEntry[];
}

export type { NetworkId };
