import type { CSSProperties } from "react";

interface IconProps {
  /** Bundled monochrome SVG; its own colour is ignored, only the shape is used. */
  src: string;
  size: number;
  /** CSS colour, usually a token: "var(--text-accent)". */
  color: string;
  className?: string;
}

/** Tints a single-colour Figma icon with a theme token via CSS mask. */
export function Icon({ src, size, color, className }: IconProps) {
  const style: CSSProperties = {
    width: size,
    height: size,
    backgroundColor: color,
    maskImage: `url("${src}")`,
    WebkitMaskImage: `url("${src}")`,
  };
  return <span className={className ? `icon ${className}` : "icon"} style={style} aria-hidden="true" />;
}
