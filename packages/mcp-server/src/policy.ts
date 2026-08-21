/**
 * Optional per-wallet spending policy. Disabled by default (sends autonomously).
 * When `policy.enabled` is set, both `send_transfer` and `execute_swap` check it
 * before signing.
 */

import type { WalletEntry } from "./keystore/types.js";
import { normalizeAddress } from "./wallet/derive.js";
import type { NetworkId } from "./config.js";
import { logInfo, logWarn } from "./log.js";

export interface PolicyCheck {
  kind: "transfer" | "swap";
  network: NetworkId;
  /** Decimal string in asset units. Required to enforce `maxPerTx`. */
  amount?: string;
  /** Transfer destination. Ignored for swaps. */
  toAddress?: string;
}

/**
 * Compare two non-negative decimal strings without floating point.
 * Returns < 0 if a < b, 0 if equal, > 0 if a > b.
 */
export function compareDecimalAmount(a: string, b: string): number {
  const pa = parseNonNegativeDecimal(a);
  const pb = parseNonNegativeDecimal(b);
  if (pa.int !== pb.int) return pa.int < pb.int ? -1 : 1;
  const len = Math.max(pa.frac.length, pb.frac.length);
  const fa = pa.frac.padEnd(len, "0");
  const fb = pb.frac.padEnd(len, "0");
  if (fa === fb) return 0;
  return fa < fb ? -1 : 1;
}

function parseNonNegativeDecimal(raw: string): { int: bigint; frac: string } {
  const t = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) {
    throw new Error(`Invalid decimal amount "${raw}".`);
  }
  const [intPart, fracPart = ""] = t.split(".");
  return { int: BigInt(intPart), frac: fracPart };
}

/** Throws with a clear message if the operation violates the wallet policy. */
export function enforcePolicy(entry: WalletEntry, check: PolicyCheck): void {
  const policy = entry.policy;
  if (!policy || !policy.enabled) {
    logInfo("policy.skip", { wallet: entry.name, reason: "disabled_or_absent" });
    return;
  }

  logInfo("policy.check", {
    wallet: entry.name,
    kind: check.kind,
    network: check.network,
    toAddress: check.toAddress,
    amount: check.amount,
    readOnly: policy.readOnly,
    maxPerTx: policy.maxPerTx,
    allowedRecipients: policy.allowedRecipients?.length ?? 0,
  });

  if (policy.readOnly) {
    logWarn("policy.reject", {
      wallet: entry.name,
      kind: check.kind,
      reason: "read_only",
    });
    throw new Error(
      check.kind === "swap"
        ? `Wallet "${entry.name}" is read-only; swaps are disabled by policy.`
        : `Wallet "${entry.name}" is read-only; sending is disabled by policy.`,
    );
  }

  if (check.amount !== undefined && policy.maxPerTx !== undefined && policy.maxPerTx !== "") {
    let cmp: number;
    try {
      cmp = compareDecimalAmount(check.amount, policy.maxPerTx);
    } catch {
      throw new Error(
        `Cannot enforce maxPerTx for wallet "${entry.name}": amounts must be non-negative decimals (got amount=${check.amount}, maxPerTx=${policy.maxPerTx}).`,
      );
    }
    if (cmp > 0) {
      logWarn("policy.reject", {
        wallet: entry.name,
        kind: check.kind,
        reason: "max_per_tx",
        amount: check.amount,
        maxPerTx: policy.maxPerTx,
      });
      throw new Error(
        `Amount ${check.amount} exceeds per-transaction limit ${policy.maxPerTx} for wallet "${entry.name}".`,
      );
    }
  }

  if (policy.allowedRecipients && policy.allowedRecipients.length > 0) {
    if (check.kind === "swap") {
      logWarn("policy.reject", {
        wallet: entry.name,
        kind: "swap",
        reason: "recipient_allow_list_blocks_swap",
      });
      throw new Error(
        `Wallet "${entry.name}" has a recipient allow-list; swaps are disabled by policy because the swap router is not a whitelisted transfer recipient.`,
      );
    }
    if (!check.toAddress) {
      throw new Error(
        `Wallet "${entry.name}" has a recipient allow-list; a destination address is required.`,
      );
    }
    const target = normalizeAddress(check.network, check.toAddress);
    const allowed = policy.allowedRecipients.some(
      (a) => normalizeAddress(check.network, a) === target,
    );
    if (!allowed) {
      logWarn("policy.reject", {
        wallet: entry.name,
        kind: "transfer",
        reason: "recipient_not_whitelisted",
        toAddress: check.toAddress,
      });
      throw new Error(
        `Recipient ${check.toAddress} is not in the whitelist for wallet "${entry.name}".`,
      );
    }
  }

  logInfo("policy.ok", {
    wallet: entry.name,
    kind: check.kind,
    network: check.network,
  });
}
