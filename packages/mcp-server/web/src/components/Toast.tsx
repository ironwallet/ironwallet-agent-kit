import { useEffect } from "react";
import checkIcon from "../assets/icon-check-20.svg";
import closeIcon from "../assets/icon-close.svg";
import { t } from "../i18n";
import { Icon } from "./Icon";

const AUTO_HIDE_MS = 6000;

interface ToastProps {
  message: string;
  onClose: () => void;
}

export function Toast({ message, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [message, onClose]);

  return (
    <div className="toast" role="status">
      <Icon src={checkIcon} size={20} color="var(--text-success)" />
      <p className="toast__text t-label-m">{message}</p>
      <button type="button" className="toast__close" onClick={onClose} aria-label={t("close")}>
        <Icon src={closeIcon} size={16} color="var(--text-success)" />
      </button>
    </div>
  );
}
