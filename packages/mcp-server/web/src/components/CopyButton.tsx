import { useEffect, useState, type ReactNode } from "react";
import checkIcon from "../assets/icon-check-20.svg";
import copyIcon from "../assets/icon-copy.svg";
import { t } from "../i18n";
import { Icon } from "./Icon";

interface CopyButtonProps {
  /** Copied to the clipboard; only public data (addresses) goes through here. */
  value: string;
  children: ReactNode;
  className?: string;
  iconSize?: number;
  /** Tooltip before copying; defaults to "Copy address". */
  label?: string;
}

const COPIED_MS = 1500;

/** Text followed by a copy icon; the icon turns into a check for a moment after copying. */
export function CopyButton({ value, children, className, iconSize = 16, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={className ? `copy-button ${className}` : "copy-button"}
      onClick={() => navigator.clipboard?.writeText(value).then(() => setCopied(true), () => undefined)}
      title={copied ? t("copied") : (label ?? t("copyAddress"))}
    >
      {children}
      <Icon
        src={copied ? checkIcon : copyIcon}
        size={iconSize}
        color={copied ? "var(--status-success)" : "currentColor"}
      />
      <span className="visually-hidden" role="status">
        {copied ? t("copied") : ""}
      </span>
    </button>
  );
}
