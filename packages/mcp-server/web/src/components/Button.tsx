import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Primary = gradient, one per screen; Secondary = outlined, reversible action. */
  variant?: "primary" | "secondary";
  /** L = 54px full-width CTA, M = 52px in dialogs and toolbars. */
  size?: "l" | "m";
  block?: boolean;
}

export function Button({
  variant = "primary",
  size = "l",
  block = false,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = ["btn", `btn--${variant}`, `btn--${size}`, block && "btn--block", className]
    .filter(Boolean)
    .join(" ");
  return <button type={type} className={classes} {...rest} />;
}
