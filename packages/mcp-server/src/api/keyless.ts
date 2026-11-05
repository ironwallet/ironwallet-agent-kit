/**
 * Gates for keyless TronGrid and TonCenter shared by balances, the manager
 * portfolio and history: the gate names match the history providers', so every
 * caller in this process lines up behind one budget per indexer.
 */

import { paced, retryRateLimited } from "./history/pace.js";

const KEYLESS_GAP_MS = 1100;
/** TronGrid suspends a keyless IP for ~5 s after a burst, TonCenter for ~2 s. */
const TRONGRID_WAIT_MS = 5500;
const TONCENTER_WAIT_MS = 2500;

export function tonApiKey(): string | undefined {
  return process.env.IW_TON_API_KEY?.trim() || undefined;
}

export function trongridCall<T>(fn: () => Promise<T>): Promise<T> {
  return retryRateLimited(() => paced("trongrid", KEYLESS_GAP_MS, fn), {
    waitMs: TRONGRID_WAIT_MS,
    attempts: 1,
  });
}

/** With an API key TonCenter lifts the limit, so the gate is off. */
export function toncenterCall<T>(fn: () => Promise<T>): Promise<T> {
  const call = () => (tonApiKey() ? fn() : paced("toncenter", KEYLESS_GAP_MS, fn));
  return retryRateLimited(call, { waitMs: TONCENTER_WAIT_MS, attempts: 1 });
}
