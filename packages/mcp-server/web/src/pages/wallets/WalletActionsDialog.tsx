import type { WalletSummary } from "../../../../src/web/contract";
import { usePortfolio } from "../../api/queries";
import deleteIcon from "../../assets/icon-delete.svg";
import editIcon from "../../assets/icon-edit.svg";
import keyIcon from "../../assets/icon-key.svg";
import shieldIcon from "../../assets/icon-shield.svg";
import { ActionRow } from "../../components/ActionRow";
import { Modal } from "../../components/Modal";
import { t } from "../../i18n";
import { balanceLabel } from "./walletBalance";

export type WalletAction = "rename" | "backup" | "reveal" | "delete";

interface WalletActionsDialogProps {
  wallet: WalletSummary;
  onAction: (action: WalletAction) => void;
  onClose: () => void;
}

export function WalletActionsDialog({ wallet, onAction, onClose }: WalletActionsDialogProps) {
  const balance = balanceLabel(usePortfolio(wallet.id));
  return (
    <Modal
      layout="list"
      title={wallet.name}
      titleAside={balance && <span className="modal__head-aside t-body-m">{balance}</span>}
      width={420}
      onClose={onClose}
    >
      <div className="action-list">
        <ActionRow icon={editIcon} label={t("walletRename")} onClick={() => onAction("rename")} />
        <ActionRow icon={shieldIcon} label={t("walletBackup")} onClick={() => onAction("backup")} />
        <ActionRow icon={keyIcon} label={t("walletShowPhrase")} onClick={() => onAction("reveal")} />
        <ActionRow icon={deleteIcon} label={t("walletDelete")} danger onClick={() => onAction("delete")} />
      </div>
    </Modal>
  );
}
