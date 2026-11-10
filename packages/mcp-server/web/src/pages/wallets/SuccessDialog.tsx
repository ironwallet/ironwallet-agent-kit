import checkIcon from "../../assets/icon-check-20.svg";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { t } from "../../i18n";

interface SuccessDialogProps {
  text: string;
  walletName: string;
  onClose: () => void;
}

export function SuccessDialog({ text, walletName, onClose }: SuccessDialogProps) {
  return (
    <Modal
      title={t("createdTitle")}
      icon={<Icon src={checkIcon} size={24} color="var(--status-success)" />}
      tone="success"
      width={420}
      onClose={onClose}
    >
      <p className="modal__text modal__text--secondary t-paragraph-m">{text}</p>
      <p className="modal__title t-h2">{walletName}</p>
      <Button block onClick={onClose}>
        {t("ok")}
      </Button>
    </Modal>
  );
}
