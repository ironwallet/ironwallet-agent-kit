import { useId, type InputHTMLAttributes } from "react";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

/** White card with a caption label above the input (Name field in the design). */
export function TextField({ label, value, onChange, className, ...rest }: TextFieldProps) {
  const id = useId();
  return (
    <div className={className ? `field ${className}` : "field"}>
      <label className="field__label t-caption" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field__input t-paragraph-m"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        {...rest}
      />
    </div>
  );
}
