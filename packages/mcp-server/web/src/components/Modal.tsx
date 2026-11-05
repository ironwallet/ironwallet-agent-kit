import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import closeIcon from "../assets/icon-close.svg";
import { t } from "../i18n";
import { Icon } from "./Icon";

interface ModalProps {
  /** Omit to make the dialog blocking: no close button, no Esc, no scrim click. */
  onClose?: () => void;
  /** Icon inside the round badge above the title. */
  icon?: ReactNode;
  tone?: "accent" | "danger" | "success" | "warning";
  title: string;
  /** "list": title left-aligned in a head row (wallet actions); default: centred. */
  layout?: "center" | "list";
  /** Shown next to the title in the list layout (e.g. the wallet balance). */
  titleAside?: ReactNode;
  children: ReactNode;
  width?: number;
  /** Extra class on the dialog box for screen-specific padding and gaps. */
  className?: string;
}

let openModals = 0;
/** Open dialogs, newest last: Esc closes only the one on top. */
const stack: object[] = [];

/** While any dialog is open, the page behind it is inert and does not scroll. */
function lockPage(): () => void {
  const root = document.getElementById("root");
  if (openModals++ === 0) {
    root?.setAttribute("inert", "");
    document.body.classList.add("modal-open");
  }
  return () => {
    if (--openModals === 0) {
      root?.removeAttribute("inert");
      document.body.classList.remove("modal-open");
    }
  };
}

export function Modal({
  onClose,
  icon,
  tone = "accent",
  title,
  layout = "center",
  titleAside,
  children,
  width = 460,
  className,
}: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [self] = useState(() => ({}));

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const unlock = lockPage();
    stack.push(self);
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
    return () => {
      stack.splice(stack.indexOf(self), 1);
      unlock();
      previous?.focus?.();
    };
  }, [self]);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stack[stack.length - 1] === self) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, self]);

  const close = onClose && (
    <button type="button" className="modal__close" onClick={onClose} aria-label={t("close")}>
      <Icon src={closeIcon} size={18} color="var(--text-secondary)" />
    </button>
  );

  return createPortal(
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        ref={dialogRef}
        className={`modal__dialog modal__dialog--${layout}${className ? ` ${className}` : ""}`}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        {layout === "list" ? (
          <div className="modal__head">
            <h2 id={titleId} className="modal__head-title t-h2">
              {title}
            </h2>
            {titleAside}
            {close}
          </div>
        ) : (
          <>
            {icon && <div className={`modal__badge modal__badge--${tone}`}>{icon}</div>}
            <h2 id={titleId} className="modal__title t-h2">
              {title}
            </h2>
            {close}
          </>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
