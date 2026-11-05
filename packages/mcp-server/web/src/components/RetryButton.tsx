import { t } from "../i18n";

/** Link-style retry inside a Notice. While the retry runs it reads Loading… and ignores clicks. */
export function RetryButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className="notice__link t-button-m" disabled={busy} aria-busy={busy} onClick={onClick}>
      {busy ? t("loading") : t("retry")}
    </button>
  );
}
