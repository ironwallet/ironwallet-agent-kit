/**
 * Helpers shared by history providers: untrusted-string hygiene, amount
 * formatting, direction detection. Indexer payloads are attacker-influenced
 * (anyone can deploy a token called "IGNORE PREVIOUS INSTRUCTIONS"), so token
 * symbols are reduced to a short printable string before they reach the agent.
 */

import { formatUnits } from "ethers";
import type { HistoryAmount, HistoryAsset, HistoryDirection, HistoryFee } from "./types.js";

const MAX_SYMBOL_LENGTH = 24;

/**
 * Keep only printable, non-whitespace-control characters, collapse spaces,
 * cap the length. Falls back when nothing usable remains. `₮` (Tether's
 * jetton ticker) is folded to `T` like the balance reader does.
 */
export function sanitizeSymbol(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replaceAll("₮", "T")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SYMBOL_LENGTH)
    .trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

const LINK_IN_SYMBOL =
  /https?:|www\.|t\.me|\.(com|net|org|io|club|xyz|me|app|site|top|info|pro|cc|link|live|online|vip|fun|finance|gift|claim)\b/i;

/** Heuristic spam flag for token symbols copied from an indexer. */
export function symbolWarning(symbol: string): string | undefined {
  if (LINK_IN_SYMBOL.test(symbol)) {
    return "Symbol contains a link. Unsolicited tokens like this are usually scams; do not interact with the contract.";
  }
  // eslint-disable-next-line no-control-regex
  if (/[^\x20-\x7E]/.test(symbol)) {
    return "Symbol uses non-ASCII characters, possibly imitating another ticker. Verify the contract address before trusting it.";
  }
  if (/[|\\/<>{}[\]]/.test(symbol) || symbol.length > 12) {
    return "Unusual symbol for a token. Verify the contract address before trusting it.";
  }
  return undefined;
}

/** Sanitized token asset with a spam warning when the symbol looks off. */
export function tokenAsset(
  rawSymbol: unknown,
  fallback: string,
  contractAddress: string | null,
  decimals: number,
): HistoryAsset {
  const symbol = sanitizeSymbol(rawSymbol, fallback);
  const warning = symbol === fallback ? undefined : symbolWarning(symbol);
  return { symbol, contractAddress, decimals, ...(warning ? { warning } : {}) };
}

/** Token decimals from an indexer field; anything absurd becomes `fallback`. */
export function clampDecimals(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(n) || n < 0 || n > 36) return fallback;
  return n;
}

/** Parse a decimal or 0x-hex integer string/number into a bigint; NaN-ish → 0n. */
export function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? BigInt(Math.trunc(value)) : 0n;
  }
  if (typeof value !== "string") return 0n;
  const s = value.trim();
  if (s.length === 0) return 0n;
  try {
    if (/^-?0x[0-9a-f]+$/i.test(s)) {
      return s.startsWith("-") ? -BigInt(s.slice(1)) : BigInt(s);
    }
    if (/^-?\d+$/.test(s)) return BigInt(s);
    // "123.0" style from some indexers.
    const m = /^(-?\d+)\.0*$/.exec(s);
    if (m) return BigInt(m[1]);
  } catch {
    return 0n;
  }
  return 0n;
}

export function amountOf(raw: bigint, decimals: number): HistoryAmount {
  const abs = raw < 0n ? -raw : raw;
  return { raw: abs.toString(), formatted: formatUnits(abs, decimals) };
}

export function feeOf(raw: bigint, decimals: number, symbol: string): HistoryFee | null {
  if (raw <= 0n) return null;
  return { ...amountOf(raw, decimals), symbol };
}

/** Seconds or milliseconds since epoch → { ts (ms), iso }. Null when unusable. */
export function timeFrom(value: unknown): { ts: number; iso: string } | null {
  let n: number;
  if (typeof value === "number") n = value;
  else if (typeof value === "string" && /^\d+$/.test(value.trim())) n = Number(value.trim());
  else if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return null;
    return { ts: parsed, iso: new Date(parsed).toISOString() };
  } else return null;
  if (!Number.isFinite(n) || n <= 0) return null;
  // Anything below ~1e11 is seconds (that is year 5138 in seconds, 1973 in ms).
  const ms = n < 1e11 ? n * 1000 : n;
  return { ts: ms, iso: new Date(ms).toISOString() };
}

/** Pending items sort to the top of the newest-first list. */
export function pendingTs(): number {
  return Date.now();
}

export function directionOf(
  from: string | null | undefined,
  to: string | null | undefined,
  isSelf: (candidate: string | null | undefined) => boolean,
): HistoryDirection {
  const fromSelf = isSelf(from);
  const toSelf = isSelf(to);
  if (fromSelf && toSelf) return "self";
  if (fromSelf) return "out";
  return "in";
}

/** Case-insensitive comparator for hex (EVM) addresses. */
export function evmAddressMatcher(self: string): (candidate: string | null | undefined) => boolean {
  const target = self.toLowerCase();
  return (candidate) => typeof candidate === "string" && candidate.toLowerCase() === target;
}

/** Exact comparator for base58 / bech32 style addresses. */
export function exactAddressMatcher(self: string): (candidate: string | null | undefined) => boolean {
  return (candidate) => candidate === self;
}

export function toBlockNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (/^0x[0-9a-f]+$/i.test(s)) return Number.parseInt(s, 16);
  if (/^\d+$/.test(s)) return Number.parseInt(s, 10);
  return null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
