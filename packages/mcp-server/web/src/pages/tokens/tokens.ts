import { useEffect, useState } from "react";
import type { TokenSort, TokenView } from "../../../../src/web/contract";

/** Native coin icons by network, for networks without a bundled logo. */
export function nativeIcons(tokens: TokenView[]): Record<string, string | null> {
  const icons: Record<string, string | null> = {};
  for (const token of tokens) if (token.address === null) icons[token.network] = token.icon;
  return icons;
}

export function matchesQuery(token: TokenView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    token.symbol.toLowerCase().includes(q) ||
    token.name.toLowerCase().includes(q) ||
    token.address?.toLowerCase() === q
  );
}

function amount(token: TokenView): number {
  return token.balance === null ? -1 : Number(token.balance);
}

export function sortTokens(tokens: TokenView[], sort: TokenSort): TokenView[] {
  const byName = (a: TokenView, b: TokenView) => a.name.localeCompare(b.name) || a.network.localeCompare(b.network);
  const sorted = [...tokens];
  if (sort === "name") return sorted.sort(byName);
  if (sort === "amount") return sorted.sort((a, b) => amount(b) - amount(a) || byName(a, b));
  return sorted.sort((a, b) => (b.usdValue ?? -1) - (a.usdValue ?? -1) || amount(b) - amount(a) || byName(a, b));
}

/** Zero balances only; a network that did not answer (null) is not a zero. */
export function hasBalance(token: TokenView): boolean {
  return token.balance === null || Number(token.balance) > 0;
}

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
