import type { ReactNode } from "react";
import type { WalletSummary } from "../../../../src/web/contract";
import checkIcon from "../../assets/icon-check-20.svg";
import moreIcon from "../../assets/icon-more-vertical.svg";
import { Icon } from "../../components/Icon";
import { t } from "../../i18n";
import { primaryAddress, shortAddress } from "./format";

interface WalletRowProps {
  wallet: WalletSummary;
  selected: boolean;
  onSelect: () => void;
  /** Omit to hide the overflow button (Backup's wallet picker). */
  onMore?: () => void;
  /** Shown before the check mark, e.g. a status tag. */
  aside?: ReactNode;
  /** Formatted USD total shown under the name instead of the address. */
  balance?: string;
}

export function WalletRow({ wallet, selected, onSelect, onMore, aside, balance }: WalletRowProps) {
  return (
    <li className={selected ? "wallet-row wallet-row--selected" : "wallet-row"}>
      <button type="button" className="wallet-row__main" onClick={onSelect} aria-pressed={selected}>
        <span className="wallet-row__meta">
          <span className="wallet-row__name t-label-l">{wallet.name}</span>
          {balance === undefined ? (
            <span className="wallet-row__sub t-data-m">{shortAddress(primaryAddress(wallet))}</span>
          ) : (
            <span className="wallet-row__sub t-body-m">{balance}</span>
          )}
        </span>
        {aside}
        {selected && (
          <span className="wallet-row__check" title={t("walletSelected")}>
            <Icon src={checkIcon} size={24} color="var(--status-success)" />
          </span>
        )}
      </button>
      {onMore && (
        <button
          type="button"
          className="wallet-row__more"
          onClick={onMore}
          aria-label={t("walletMore", { name: wallet.name })}
        >
          <Icon src={moreIcon} size={22} color="var(--text-tertiary)" />
        </button>
      )}
    </li>
  );
}
