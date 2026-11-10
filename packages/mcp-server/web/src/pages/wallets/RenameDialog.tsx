import { useState, type FormEvent } from "react";
import type { WalletSummary } from "../../../../src/web/contract";
import { errorMessage } from "../../api/client";
import { useRenameWallet } from "../../api/queries";
import editIcon from "../../assets/icon-edit.svg";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { t } from "../../i18n";

interface RenameDialogProps {
  wallet: WalletSummary;
  onClose: () => void;
}

export function RenameDialog({ wallet, onClose }: RenameDialogProps) {
  const [name, setName] = useState(wallet.name);
  const rename = useRenameWallet();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    rename.mutate({ id: wallet.id, name }, { onSuccess: onClose });
  };

  return (
    <Modal
      title={t("renameTitle")}
      icon={<Icon src={editIcon} size={26} color="var(--text-accent)" />}
      width={420}
      onClose={onClose}
    >
      <form className="dialog-form" onSubmit={submit}>
        <p className="modal__text t-paragraph-m">{t("renameText")}</p>
        <input
          className="dialog-input t-body-l"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={t("fieldName")}
          maxLength={40}
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
        {rename.isError && <p className="form-error t-paragraph-s">{errorMessage(rename.error)}</p>}
        <div className="button-row">
          <Button variant="secondary" onClick={onClose}>
            {t("back")}
          </Button>
          <Button type="submit" disabled={!name.trim() || rename.isPending}>
            {t("save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
