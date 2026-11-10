import { useState } from "react";

interface TokenIconProps {
  /** Relative `icons/<network>/<assetId>` URL from the API; null when the catalog has none. */
  src: string | null | undefined;
  /** First letter goes into the fallback circle. */
  label: string;
  size: number;
}

/** Round token or network image with a letter avatar when there is none or it fails to load. */
export function TokenIcon({ src, label, size }: TokenIconProps) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span
        className="token-icon token-icon--fallback"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
        aria-hidden="true"
      >
        {label.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <img className="token-icon" src={src} alt="" width={size} height={size} onError={() => setFailed(true)} />
  );
}
