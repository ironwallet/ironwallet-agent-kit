import type { ReactNode } from "react";
import chevronLeft from "../assets/icon-chevron-left.svg";
import { t } from "../i18n";
import { Icon } from "./Icon";

interface ScreenHeaderProps {
  title: ReactNode;
  /** Hash link for the back chevron; omit to hide it. */
  backHref?: string;
}

export function ScreenHeader({ title, backHref }: ScreenHeaderProps) {
  return (
    <div className="screen-header">
      {backHref && (
        <a className="screen-header__back" href={backHref} aria-label={t("back")}>
          <Icon src={chevronLeft} size={24} color="var(--text-secondary)" />
        </a>
      )}
      <h1 className="screen-header__title t-h1">{title}</h1>
      {backHref && <span className="screen-header__spacer" />}
    </div>
  );
}
