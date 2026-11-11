import { useId, useRef, useState, type FormEvent } from "react";
import { errorMessage } from "../../api/client";
import { useImportWallet, useWallets } from "../../api/queries";
import { Button } from "../../components/Button";
import { ScreenHeader } from "../../components/ScreenHeader";
import { TextField } from "../../components/TextField";
import { t } from "../../i18n";
import { navigate } from "../../router";
import { defaultWalletName } from "./format";
import { SuccessDialog } from "./SuccessDialog";

/** BIP-39 phrase lengths. */
const LENGTHS = [12, 15, 18, 21, 24];

function wordCount(phrase: string): number {
  return phrase.trim() ? phrase.trim().split(/\s+/).length : 0;
}

export function ImportWalletPage() {
  const wallets = useWallets();
  const importWallet = useImportWallet();
  const [name, setName] = useState<string | null>(null);
  const [phrase, setPhrase] = useState("");
  const phraseId = useId();
  const phraseRef = useRef<HTMLTextAreaElement>(null);
  const value = name ?? (wallets.data ? defaultWalletName(wallets.data.wallets) : "");

  const count = wordCount(phrase);
  const total = LENGTHS.find((n) => n >= count) ?? 24;
  const ready = LENGTHS.includes(count);

  const editPhrase = (next: string) => {
    setPhrase(next);
    if (importWallet.isError) importWallet.reset();
  };

  const paste = async () => {
    try {
      editPhrase(await navigator.clipboard.readText());
    } catch {
      phraseRef.current?.focus();
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    importWallet.mutate(
      { name: value, mnemonic: phrase },
      { onSuccess: () => setPhrase("") },
    );
  };

  return (
    <form className="page page--form page--tight" onSubmit={submit}>
      <ScreenHeader title={t("importTitle")} />
      <TextField label={t("fieldName")} value={value} onChange={setName} maxLength={40} />
      <div className="field field--phrase">
        <div className="field__row">
          <label className="field__label t-caption" htmlFor={phraseId}>
            {t("importPhraseLabel", { count: total })}
          </label>
          <button type="button" className="field__action t-button-m" onClick={() => void paste()}>
            {t("importPaste")}
          </button>
        </div>
        <textarea
          id={phraseId}
          ref={phraseRef}
          className="field__input field__input--phrase t-paragraph-m"
          value={phrase}
          onChange={(e) => editPhrase(e.target.value)}
          placeholder={t("importPhrasePlaceholder")}
          rows={2}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          autoFocus
        />
        {count > 0 && (
          <p className={ready ? "field__status field__status--ok t-label-s" : "field__status t-label-s"}>
            {t("importWordCount", { n: count, total })}
          </p>
        )}
      </div>
      <p className="page__hint t-paragraph-s">{t("importNeverShare")}</p>
      {importWallet.isError && <p className="form-error t-paragraph-s">{errorMessage(importWallet.error)}</p>}
      <div className="button-row button-row--spaced">
        <Button variant="secondary" size="m" onClick={() => navigate("wallets")}>
          {t("back")}
        </Button>
        <Button type="submit" size="m" disabled={!ready || !value.trim() || importWallet.isPending}>
          {t("importSubmit")}
        </Button>
      </div>
      {importWallet.data && (
        <SuccessDialog
          text={t("importedText")}
          walletName={importWallet.data.wallet.name}
          onClose={() => navigate("wallets")}
        />
      )}
    </form>
  );
}
