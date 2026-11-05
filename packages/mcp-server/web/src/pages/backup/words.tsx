import { useEffect, useRef, useState } from "react";
import type { MnemonicResponse } from "../../../../src/web/contract";
import { api, errorMessage } from "../../api/client";

interface WordChipProps {
  word: string;
  /** 0-based position; shown as "01", "02"… when set. */
  index?: number;
  onClick?: () => void;
  used?: boolean;
}

export function WordChip({ word, index, onClick, used = false }: WordChipProps) {
  const content = (
    <>
      {index !== undefined && <span className="word-chip__index t-data-s">{String(index + 1).padStart(2, "0")}</span>}
      <span className="word-chip__word">{word}</span>
    </>
  );
  if (!onClick) return <li className="word-chip">{content}</li>;
  return (
    <li>
      <button
        type="button"
        className={used ? "word-chip word-chip--button word-chip--used" : "word-chip word-chip--button"}
        onClick={onClick}
        disabled={used}
      >
        {content}
      </button>
    </li>
  );
}

/** The phrase in reading order, numbered. */
export function WordGrid({ words }: { words: string[] }) {
  return (
    <ol className="word-list" aria-label={`${words.length} words`}>
      {words.map((w, i) => (
        <WordChip key={i} word={w} index={i} />
      ))}
    </ol>
  );
}

/**
 * Fetches the recovery phrase on demand and keeps it only in this component's
 * state: it is not put in the query cache and is gone when the dialog closes.
 */
export function usePhrase(walletId: string) {
  const [words, setWords] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = async (): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      const r = await api.post<MnemonicResponse>(`wallets/${walletId}/mnemonic`, {});
      if (mounted.current) setWords(r.words);
      return true;
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
      return false;
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  return { words, error, pending, load };
}

/** Positions 0..n-1 in a random order that is never the original one. */
export function shuffledOrder(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  if (n < 2) return order;
  const rand = new Uint32Array(n);
  do {
    crypto.getRandomValues(rand);
    for (let i = n - 1; i > 0; i--) {
      const j = rand[i] % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
  } while (order.every((v, i) => v === i));
  return order;
}
