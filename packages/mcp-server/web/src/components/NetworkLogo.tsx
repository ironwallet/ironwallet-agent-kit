import { networkLogo, networkName } from "../networks";
import { TokenIcon } from "./TokenIcon";

interface NetworkLogoProps {
  network: string;
  size: number;
  /** Native coin icon for networks without a bundled logo (Litecoin, Dogecoin). */
  fallback?: string | null;
}

export function NetworkLogo({ network, size, fallback }: NetworkLogoProps) {
  return <TokenIcon src={networkLogo(network) ?? fallback} label={networkName(network)} size={size} />;
}
