import type { WalletSummary } from "../../../../src/web/contract";
import keyIcon from "../../assets/icon-key.svg";
import shieldIcon from "../../assets/icon-shield.svg";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { Notice } from "../../components/Notice";
import { t } from "../../i18n";
import { usePhrase, WordGrid } from "./words";

interface RevealPhraseDialogProps {
  wallet: WalletSummary;
  onClose: () => void;
}

/** "Show secret phrase": a privacy check, then the words. Does not mark the wallet backed up. */
export function RevealPhraseDialog({ wallet, onClose }: RevealPhraseDialogProps) {
  const phrase = usePhrase(wallet.id);

  if (!phrase.words) {
    return (
      <Modal
        title={t("revealTitle")}
        icon={<Icon src={shieldIcon} size={24} color="var(--text-accent)" />}
        width={420}
        onClose={onClose}
      >
        <p className="modal__text t-paragraph-m">{t("revealText")}</p>
        {phrase.error && <p className="form-error t-paragraph-s">{phrase.error}</p>}
        <div className="button-row button-row--spaced">
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={phrase.pending} onClick={() => void phrase.load()}>
            {t("revealButton")}
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={t("recoveryTitle")}
      icon={<Icon src={keyIcon} size={24} color="var(--text-warning)" />}
      tone="warning"
      width={520}
      onClose={onClose}
    >
      <p className="modal__text t-paragraph-m">{t("recoveryText", { n: phrase.words.length })}</p>
      <WordGrid words={phrase.words} />
      <Notice plain>{t("recoveryWarning")}</Notice>
      <Button block onClick={onClose}>
        {t("recoveryDone")}
      </Button>
    </Modal>
  );
}
