import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import chevronLeft from "../assets/icon-chevron-left.svg";
import chevronRight from "../assets/icon-chevron-right.svg";
import { t } from "../i18n";
import { Icon } from "./Icon";

interface ChipRowProps {
  label: string;
  className?: string;
  children: ReactNode;
}

/**
 * One line of chips that scrolls sideways. Arrows appear on the side that has
 * more chips, and a vertical mouse wheel scrolls the row while the pointer is
 * over it (until the row reaches its end), so no horizontal wheel is needed.
 * The arrows are skipped by Tab: focusing a chip scrolls it into view anyway.
 */
export function ChipRow({ label, className, children }: ChipRowProps) {
  const row = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ start: false, end: false });

  const update = useCallback(() => {
    const el = row.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setMore((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    update();
    const resize = new ResizeObserver(update);
    resize.observe(el);
    for (const chip of Array.from(el.children)) resize.observe(chip);
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const atEdge =
        e.deltaY < 0 ? el.scrollLeft <= 0 : el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      if (atEdge) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      resize.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, [update, children]);

  const page = (direction: 1 | -1) => {
    const el = row.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: "smooth" });
  };

  return (
    <div className={className ? `chip-scroller ${className}` : "chip-scroller"}>
      <div ref={row} className="chip-row" role="group" aria-label={label} onScroll={update}>
        {children}
      </div>
      {more.start && (
        <div className="chip-scroller__edge chip-scroller__edge--start">
          <button
            type="button"
            className="chip-scroller__arrow"
            tabIndex={-1}
            aria-label={t("scrollBack")}
            onClick={() => page(-1)}
          >
            <Icon src={chevronLeft} size={20} color="var(--text-secondary)" />
          </button>
        </div>
      )}
      {more.end && (
        <div className="chip-scroller__edge chip-scroller__edge--end">
          <button
            type="button"
            className="chip-scroller__arrow"
            tabIndex={-1}
            aria-label={t("scrollForward")}
            onClick={() => page(1)}
          >
            <Icon src={chevronRight} size={20} color="var(--text-secondary)" />
          </button>
        </div>
      )}
    </div>
  );
}
