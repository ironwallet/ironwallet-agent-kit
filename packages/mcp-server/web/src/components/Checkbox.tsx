import type { ReactNode } from "react";
import checkIcon from "../assets/icon-check.svg";
import { Icon } from "./Icon";

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}

export function Checkbox({ checked, onChange, children }: CheckboxProps) {
  return (
    <label className="checkbox">
      <input
        type="checkbox"
        className="checkbox__input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="checkbox__box" aria-hidden="true">
        {checked && <Icon src={checkIcon} size={16} color="var(--text-on-accent)" />}
      </span>
      <span className="checkbox__label t-paragraph-s">{children}</span>
    </label>
  );
}
