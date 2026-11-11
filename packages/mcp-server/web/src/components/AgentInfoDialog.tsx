import infoIcon from "../assets/icon-info.svg";
import { t } from "../i18n";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

export function AgentInfoDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      onClose={onClose}
      title={t("agentInfoTitle")}
      icon={<Icon src={infoIcon} size={24} color="var(--text-accent)" />}
    >
      <p className="modal__text t-paragraph-m">{t("agentInfoText")}</p>
      <ol className="steps">
        <li className="steps__item">
          <span className="steps__n t-label-s">1</span>
          <span className="t-paragraph-s">{t("agentInfoStep1")}</span>
        </li>
        <li className="steps__item">
          <span className="steps__n t-label-s">2</span>
          <span className="t-paragraph-s">{t("agentInfoStep2")}</span>
        </li>
      </ol>
      <Button block onClick={onClose}>
        {t("gotIt")}
      </Button>
    </Modal>
  );
}
