/**
 * Process-wide request gates for keyless public indexers with per-IP rate
 * limits (TonCenter ≈ 1 rps, TronGrid 3 rps). A provider's sources run in
 * parallel and may load two pages each, so without a gate a single tool call
 * bursts past the limit and the indexer suspends the IP for several seconds.
 */

const gates = new Map<string, number>();

/** Run `fn` no sooner than `gapMs` after the previous call through the same gate. */
export async function paced<T>(gate: string, gapMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const startAt = Math.max(now, gates.get(gate) ?? 0);
  gates.set(gate, startAt + gapMs);
  if (startAt > now) await new Promise((resolve) => setTimeout(resolve, startAt - now));
  return fn();
}
