interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name; the visible label usually sits next to the switch. */
  label: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={checked ? "toggle toggle--on" : "toggle"}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__knob" />
    </button>
  );
}
