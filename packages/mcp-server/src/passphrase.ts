/**
 * Keystore wrapping secret. Generated on first use and stored under
 * ~/.ironwallet-mcp/. IW_PASSPHRASE overrides when set to a real value.
 */

import { resolveKeystorePassphrase } from "./local-secrets.js";

/** Env override, else local file, else generate. */
export function requirePassphrase(): string {
  return resolveKeystorePassphrase();
}
