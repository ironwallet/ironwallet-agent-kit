import type { WalletSummary } from "../../../../src/web/contract";
import { t } from "../../i18n";

/** `0x9ac2…ffa0c1`: enough to tell wallets apart, short enough for one line. */
export function shortAddress(address: string): string {
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address;
}

/** EVM address: the same on every EVM network and present on every wallet. */
export function primaryAddress(wallet: WalletSummary): string {
  return wallet.addresses.ethereum ?? Object.values(wallet.addresses)[0] ?? "";
}

/** "Wallet #N" with the first free N from count + 1 (names are unique ignoring case). */
export function defaultWalletName(wallets: WalletSummary[]): string {
  const taken = new Set(wallets.map((w) => w.name.toLowerCase()));
  let n = wallets.length + 1;
  while (taken.has(t("walletDefaultName", { n }).toLowerCase())) n++;
  return t("walletDefaultName", { n });
}
