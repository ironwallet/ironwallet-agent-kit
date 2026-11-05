import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { VerifyBackupRequest, WalletResponse, WalletSummary } from "../../../../src/web/contract";
import { api, errorMessage } from "../../api/client";
import { queryKeys } from "../../api/queries";
import checkIcon from "../../assets/icon-check-20.svg";
import warningIcon from "../../assets/icon-warning.svg";
import { Button } from "../../components/Button";
import { Checkbox } from "../../components/Checkbox";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { Notice } from "../../components/Notice";
import { t } from "../../i18n";
import { shuffledOrder, usePhrase, WordChip, WordGrid } from "./words";

interface BackupDialogProps {
  wallet: WalletSummary;
  onClose: () => void;
}

type Step = "warning" | "phrase" | "verify" | "verified";

/** Manual backup: safety warning, the words, putting them back in order, done. */
export function BackupDialog({ wallet, onClose }: BackupDialogProps) {
  const [step, setStep] = useState<Step>("warning");
  const [accepted, setAccepted] = useState(false);
  const phrase = usePhrase(wallet.id);

  const start = async () => {
    if (phrase.words || (await phrase.load())) setStep("phrase");
  };

  if (step === "warning") {
    return (
      <Modal
        title={t("safetyTitle")}
        icon={<Icon src={warningIcon} size={24} color="var(--text-warning)" />}
        tone="warning"
        width={440}
        onClose={onClose}
      >
        <p className="modal__text t-paragraph-m">{t("safetyText")}</p>
        <div className="checkbox-card">
          <Checkbox checked={accepted} onChange={setAccepted}>
            {t("safetyAccept")}
          </Checkbox>
        </div>
        {phrase.error && <p className="form-error t-paragraph-s">{phrase.error}</p>}
        <div className="button-row button-row--spaced">
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={!accepted || phrase.pending} onClick={() => void start()}>
            {t("continue")}
          </Button>
        </div>
      </Modal>
    );
  }

  if (step === "phrase" && phrase.words) {
    return (
      <Modal title={t("passphraseTitle")} width={560} onClose={onClose}>
        <p className="modal__text t-paragraph-m">{t("passphraseText")}</p>
        <WordGrid words={phrase.words} />
        <Notice tone="danger" plain>
          {t("passphraseWarning")}
        </Notice>
        <div className="button-row">
          <Button variant="secondary" onClick={() => setStep("warning")}>
            {t("back")}
          </Button>
          <Button onClick={() => setStep("verify")}>{t("continue")}</Button>
        </div>
      </Modal>
    );
  }

  if (step === "verify" && phrase.words) {
    return (
      <VerifyStep
        wallet={wallet}
        words={phrase.words}
        onBack={() => setStep("phrase")}
        onVerified={() => setStep("verified")}
        onClose={onClose}
      />
    );
  }

  return (
    <Modal
      title={t("verifiedTitle")}
      icon={<Icon src={checkIcon} size={24} color="var(--status-success)" />}
      tone="success"
      width={440}
      onClose={onClose}
    >
      <p className="modal__text t-paragraph-m">{t("verifiedText")}</p>
      <Button block onClick={onClose}>
        {t("done")}
      </Button>
    </Modal>
  );
}

interface VerifyStepProps {
  wallet: WalletSummary;
  words: string[];
  onBack: () => void;
  onVerified: () => void;
  onClose: () => void;
}

/** Words are tracked by position, not by text: a phrase may repeat a word. */
function VerifyStep({ wallet, words, onBack, onVerified, onClose }: VerifyStepProps) {
  const client = useQueryClient();
  const pool = useMemo(() => shuffledOrder(words.length), [words]);
  const [answer, setAnswer] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const pick = (position: number) => {
    setError(null);
    setAnswer((a) => [...a, position]);
  };
  const unpick = (slot: number) => {
    setError(null);
    setAnswer((a) => a.filter((_, i) => i !== slot));
  };

  const verify = async () => {
    setPending(true);
    try {
      const body: VerifyBackupRequest = { words: answer.map((p) => words[p]) };
      await api.post<WalletResponse>(`wallets/${wallet.id}/backup/verify`, body);
      await client.invalidateQueries({ queryKey: queryKeys.wallets });
      onVerified();
    } catch (e) {
      setError(errorMessage(e));
      setPending(false);
    }
  };

  return (
    <Modal title={t("verifyTitle")} width={600} onClose={onClose}>
      <div className="word-box">
        <p className="word-box__hint t-paragraph-m">{t("verifyHint")}</p>
        <ul className="word-list">
          {pool.map((p) => (
            <WordChip key={p} word={words[p]} used={answer.includes(p)} onClick={() => pick(p)} />
          ))}
        </ul>
      </div>
      <div className="word-box">
        {answer.length === 0 ? (
          <p className="word-box__hint t-paragraph-s">{t("verifyAnswerHint")}</p>
        ) : (
          <ol className="word-list">
            {answer.map((p, slot) => (
              <WordChip key={p} word={words[p]} index={slot} onClick={() => unpick(slot)} />
            ))}
          </ol>
        )}
      </div>
      {error && <p className="form-error t-paragraph-s">{error}</p>}
      <div className="button-row">
        <Button variant="secondary" onClick={onBack}>
          {t("back")}
        </Button>
        <Button disabled={answer.length !== words.length || pending} onClick={() => void verify()}>
          {t("verifySubmit")}
        </Button>
      </div>
    </Modal>
  );
}
