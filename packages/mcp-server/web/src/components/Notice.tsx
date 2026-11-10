import type { ReactNode } from "react";
import warningIcon from "../assets/icon-warning.svg";
import { Icon } from "./Icon";

interface NoticeProps {
  tone?: "warning" | "danger";
  /** Bordered variant is used inside dialogs. */
  bordered?: boolean;
  /** Centred text without the icon (recovery phrase dialogs). */
  plain?: boolean;
  /** "m": 24px icon and Paragraph/M text (page-level alerts). */
  size?: "s" | "m";
  /** H4 line above the text. */
  title?: ReactNode;
  children: ReactNode;
}

/** Warning box: tinted surface, warning icon, Paragraph/S text. */
export function Notice({ tone = "warning", bordered = false, plain = false, size = "s", title, children }: NoticeProps) {
  const className = [
    "notice",
    `notice--${tone}`,
    bordered && "notice--bordered",
    plain && "notice--plain",
    size === "m" && "notice--m",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={className} role="note">
      {!plain && <Icon src={warningIcon} size={size === "m" ? 24 : 20} color="currentColor" />}
      <div className={`notice__body ${size === "m" ? "t-paragraph-m" : "t-paragraph-s"}`}>
        {title && <p className="notice__title t-h4">{title}</p>}
        {children}
      </div>
    </div>
  );
}
