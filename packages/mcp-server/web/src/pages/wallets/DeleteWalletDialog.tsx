import { useState } from "react";
import type { WalletSummary } from "../../../../src/web/contract";
import { errorMessage } from "../../api/client";
import { useDeleteWallet, usePortfolio } from "../../api/queries";
import warningIcon from "../../assets/icon-warning.svg";
import { Button } from "../../components/Button";
import { Checkbox } from "../../components/Checkbox";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { Notice } from "../../components/Notice";
import { t } from "../../i18n";
import { formatUsd } from "../../money";
import { primaryAddress, shortAddress } from "./format";

interface DeleteWalletDialogProps {
  wallet: WalletSummary;
  onClose: () => void;
  onBackup: () => void;
  onDeleted: () => void;
}

const badge = <Icon src={warningIcon} size={24} color="var(--text-danger)" />;

/** Two steps: "are you sure" with a backup shortcut, then an explicit acknowledgement. */
export function DeleteWalletDialog({ wallet, onClose, onBackup, onDeleted }: DeleteWalletDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [acknowledged, setAcknowledged] = useState(false);
  const remove = useDeleteWallet();
  const portfolio = usePortfolio(wallet.id);
  const funds = portfolio.data && portfolio.data.totalUsd > 0 ? formatUsd(portfolio.data.totalUsd) : null;

  if (step === 1) {
    return (
      <Modal title={t("deleteTitle", { name: wallet.name })} icon={badge} tone="danger" width={420} onClose={onClose}>
        <p className="modal__text t-paragraph-m">
          {funds && (
            <>
              {t("deleteFunds", { amount: funds })}
              <br />
            </>
          )}
          {t("deleteQuestion")}
        </p>
        <Notice bordered>
          <p>{t("deleteWarning")}</p>
          <button type="button" className="notice__link t-button-m" onClick={onBackup}>
            {t("deleteBackupLink")}
          </button>
        </Notice>
        <div className="button-row button-row--spaced">
          <Button variant="secondary" onClick={onClose}>
            {t("deleteKeep")}
          </Button>
          <Button onClick={() => setStep(2)}>{t("deleteForever")}</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t("deleteConfirmTitle")} icon={badge} tone="danger" onClose={onClose}>
      <p className="modal__text t-paragraph-m">{t("deleteConfirmText")}</p>
      <dl className="summary">
        <div className="summary__row">
          <dt className="t-body-s">{t("deleteSummaryWallet")}</dt>
          <dd className="summary__value">
            <span className="summary__name">{wallet.name}</span>
            <span className="t-data-s">{shortAddress(primaryAddress(wallet))}</span>
          </dd>
        </div>
        {funds && (
          <div className="summary__row">
            <dt className="t-body-s">{t("deleteSummaryFunds")}</dt>
            <dd className="summary__value">
              <span className="summary__name">{funds}</span>
            </dd>
          </div>
        )}
      </dl>
      <Checkbox checked={acknowledged} onChange={setAcknowledged}>
        {t("deleteAcknowledge")}
      </Checkbox>
      {remove.isError && <p className="form-error t-paragraph-s">{errorMessage(remove.error)}</p>}
      <div className="button-row button-row--spaced">
        <Button variant="secondary" onClick={onClose}>
          {t("deleteKeep")}
        </Button>
        <Button
          disabled={!acknowledged || remove.isPending}
          onClick={() => remove.mutate(wallet.id, { onSuccess: onDeleted })}
        >
          {t("deleteForever")}
        </Button>
      </div>
    </Modal>
  );
}
