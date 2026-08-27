/**
 * Optional per-wallet spending policy. Disabled by default (sends autonomously).
 * When `policy.enabled` is set, both `send_transfer` and `execute_swap` check it
 * before signing. `maxPerTxUsd` converts the amount via the rates backend at the
 * moment of the operation and fails closed when no rate is available.
 */

import type { WalletEntry, WalletPolicy } from "./keystore/types.js";
import { normalizeAddress } from "./wallet/derive.js";
import type { NetworkId } from "./config.js";
import { getUsdRate } from "./api/rates.js";
import { logInfo, logWarn } from "./log.js";

export interface PolicyCheck {
  kind: "transfer" | "swap";
  network: NetworkId;
  /** Transfer destination. Ignored for swaps. */
  toAddress?: string;
}

export interface UsdLimitCheck {
  kind: "transfer" | "swap";
  network: NetworkId;
  /** Decimal string in asset units (final amount that will be signed). */
  amount: string;
  /** Asset symbol, used for catalog fallback matching and messages. */
  symbol?: string;
  /** Token contract. Omit for the native coin. */
  tokenAddress?: string;
  correlationId?: string;
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

/** Render a float (e.g. a JSON rate) as a plain decimal string, no exponent. */
export function numberToDecimalString(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid rate ${n}.`);
  }
  const s = String(n);
  if (!/[eE]/.test(s)) return s;
  // ≥ 1e21 serializes exponentially even via toFixed; such floats are integral.
  if (n >= 1e21) return BigInt(n).toString();
  // 1e-7 and friends: expand via toFixed and trim trailing zeros.
  const fixed = n.toFixed(20);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

/** Multiply two non-negative decimal strings exactly (BigInt, no float). */
export function multiplyDecimalAmounts(a: string, b: string): string {
  const pa = parseNonNegativeDecimal(a);
  const pb = parseNonNegativeDecimal(b);
  const scaleA = pa.frac.length;
  const scaleB = pb.frac.length;
  const rawA = BigInt(`${pa.int}${pa.frac}` || "0");
  const rawB = BigInt(`${pb.int}${pb.frac}` || "0");
  const product = rawA * rawB;
  const scale = scaleA + scaleB;
  if (scale === 0) return product.toString();
  const digits = product.toString().padStart(scale + 1, "0");
  const intPart = digits.slice(0, -scale);
  const fracPart = digits.slice(-scale).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

/** Always-present policy for `list_wallets` (`enabled: false` when unset). */
export function listWalletPolicy(policy: WalletPolicy | undefined): WalletPolicy {
  if (!policy || !policy.enabled) return { enabled: false };
  return policy;
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
    readOnly: policy.readOnly,
    maxPerTxUsd: policy.maxPerTxUsd,
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

  // The allow-list constrains transfer destinations only. Swaps are exempt:
  // execute_swap has no recipient input — the bought asset is always paid out
  // to this wallet's own keystore address on the buy network.
  if (
    check.kind === "transfer" &&
    policy.allowedRecipients &&
    policy.allowedRecipients.length > 0
  ) {
    if (!check.toAddress) {
      throw new Error(
        `Wallet "${entry.name}" has a recipient allow-list; a destination address is required.`,
      );
    }
    const target = normalizeAddress(check.network, check.toAddress);
    // Entries for other networks (or malformed ones) must not break the check:
    // normalizeAddress throws on non-EVM strings for EVM networks.
    const allowed = policy.allowedRecipients.some((a) => {
      try {
        return normalizeAddress(check.network, a) === target;
      } catch {
        return false;
      }
    });
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

/** Pure part of the USD check: amount × rate vs limit. Throws on violation. */
export function assertUsdWithinLimit(opts: {
  wallet: string;
  kind: "transfer" | "swap";
  amount: string;
  rate: number;
  maxPerTxUsd: string;
  assetLabel: string;
}): { usdValue: string } {
  const usdValue = multiplyDecimalAmounts(
    opts.amount,
    numberToDecimalString(opts.rate),
  );
  if (compareDecimalAmount(usdValue, opts.maxPerTxUsd) > 0) {
    throw new Error(
      `${opts.kind === "swap" ? "Swap sell" : "Transfer"} amount ${opts.amount} ${opts.assetLabel} ` +
        `≈ $${usdValue} exceeds the ${opts.maxPerTxUsd} USD per-transaction limit for wallet "${opts.wallet}".`,
    );
  }
  return { usdValue };
}

/**
 * Enforce `maxPerTxUsd` right before signing. Fail closed: if the limit is set
 * and the USD rate cannot be resolved, the operation is rejected.
 */
export async function enforceUsdLimit(
  entry: WalletEntry,
  check: UsdLimitCheck,
): Promise<void> {
  const policy = entry.policy;
  const limit = policy?.enabled ? policy.maxPerTxUsd : undefined;
  if (!limit) return;

  const assetLabel = check.symbol ?? (check.tokenAddress ? "token" : check.network);
  const rate = await getUsdRate(
    {
      network: check.network,
      symbol: check.symbol,
      tokenAddress: check.tokenAddress,
    },
    check.correlationId,
  );

  if (rate === undefined) {
    logWarn("policy.reject", {
      wallet: entry.name,
      kind: check.kind,
      reason: "usd_rate_unavailable",
      network: check.network,
      symbol: check.symbol,
      tokenAddress: check.tokenAddress,
    });
    throw new Error(
      `Wallet "${entry.name}" has a ${limit} USD per-transaction limit, but no USD rate ` +
        `is available for ${assetLabel} on ${check.network} right now. ` +
        `The operation was rejected (fail closed). Retry later or adjust the policy.`,
    );
  }

  let usdValue: string;
  try {
    ({ usdValue } = assertUsdWithinLimit({
      wallet: entry.name,
      kind: check.kind,
      amount: check.amount,
      rate,
      maxPerTxUsd: limit,
      assetLabel,
    }));
  } catch (e) {
    logWarn("policy.reject", {
      wallet: entry.name,
      kind: check.kind,
      reason: "max_per_tx_usd",
      amount: check.amount,
      rate,
      maxPerTxUsd: limit,
    });
    throw e;
  }

  logInfo("policy.usd.ok", {
    wallet: entry.name,
    kind: check.kind,
    network: check.network,
    amount: check.amount,
    rate,
    usdValue,
    maxPerTxUsd: limit,
  });
}
