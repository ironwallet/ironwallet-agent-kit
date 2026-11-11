import markOnDark from "../assets/logo-mark-on-dark.svg";
import mark from "../assets/logo-mark.svg";
import wordOnDark from "../assets/logo-word-on-dark.svg";
import word from "../assets/logo-word.svg";

interface LogoProps {
  /** header = themed (dark word in light theme), footer = all white on the brand gradient. */
  variant: "header" | "footer";
}

/** The two Figma parts of "Logo IronWallet", placed with the file's relative insets. */
export function Logo({ variant }: LogoProps) {
  const footer = variant === "footer";
  return (
    <span className={`logo logo--${variant}`} role="img" aria-label="IronWallet">
      <img className="logo__mark" src={footer ? markOnDark : mark} alt="" />
      {footer ? (
        <img className="logo__word" src={wordOnDark} alt="" />
      ) : (
        <>
          <img className="logo__word theme-light-only" src={word} alt="" />
          <img className="logo__word theme-dark-only" src={wordOnDark} alt="" />
        </>
      )}
    </span>
  );
}
