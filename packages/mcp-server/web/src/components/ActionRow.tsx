import chevronRight from "../assets/icon-chevron-right.svg";
import { Icon } from "./Icon";

interface ActionRowProps {
  icon: string;
  label: string;
  danger?: boolean;
  onClick: () => void;
}

/** List row / Action: 34px icon tile, label, trailing chevron. */
export function ActionRow({ icon, label, danger = false, onClick }: ActionRowProps) {
  return (
    <button type="button" className={danger ? "action-row action-row--danger" : "action-row"} onClick={onClick}>
      <span className="action-row__tile">
        <Icon src={icon} size={20} color={danger ? "var(--text-danger)" : "var(--text-accent)"} />
      </span>
      <span className="action-row__label t-label-l">{label}</span>
      <Icon src={chevronRight} size={20} color="var(--text-tertiary)" />
    </button>
  );
}
