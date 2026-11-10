import { useEffect, useRef, type ReactNode } from "react";

interface DropdownProps {
  open: boolean;
  onClose: () => void;
  /** The button that toggles the panel; the panel is positioned under it. */
  trigger: ReactNode;
  /** "center": under the middle of the trigger (wallet picker); "end": right edges aligned (sort). */
  align?: "center" | "end";
  width: number;
  label: string;
  /** Panel class for its padding and gaps. */
  className: string;
  children: ReactNode;
}

/** Floating panel under a trigger; closes on Esc and on a click outside. */
export function Dropdown({ open, onClose, trigger, align = "center", width, label, className, children }: DropdownProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div className="dropdown" ref={rootRef}>
      {trigger}
      {open && (
        <div
          ref={panelRef}
          className={`dropdown__panel dropdown__panel--${align} ${className}`}
          style={{ width }}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
        >
          {children}
        </div>
      )}
    </div>
  );
}
