import { useCallback, useState } from "react";
import type { WalletSummary } from "../../../../src/web/contract";
import { useSelectWallet } from "../../api/queries";
import checkIcon from "../../assets/icon-check-20.svg";
import chevronDown from "../../assets/icon-chevron-down.svg";
import { Button } from "../../components/Button";
import { Dropdown } from "../../components/Dropdown";
import { Icon } from "../../components/Icon";
import { t } from "../../i18n";
import { navigate } from "../../router";
import { primaryAddress, shortAddress } from "../wallets/format";

interface WalletPickerProps {
  wallets: WalletSummary[];
  current: WalletSummary;
}

/** Chip with the wallet name; opens the list of wallets and a shortcut to the Wallets page. */
export function WalletPicker({ wallets, current }: WalletPickerProps) {
  const [open, setOpen] = useState(false);
  const select = useSelectWallet();
  const close = useCallback(() => setOpen(false), []);

  return (
    <Dropdown
      open={open}
      onClose={close}
      width={290}
      label={t("walletPickerTitle")}
      className="wallet-menu"
      trigger={
        <button type="button" className="wallet-chip" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="wallet-chip__name">{current.name}</span>
          <Icon src={chevronDown} size={18} color="var(--text-secondary)" />
        </button>
      }
    >
      <ul className="picker-list">
        {wallets.map((w) => {
          const selected = w.id === current.id;
          return (
            <li key={w.id}>
              <button
                type="button"
                className={selected ? "picker-row picker-row--selected" : "picker-row"}
                aria-pressed={selected}
                onClick={() => {
                  if (!selected) select.mutate(w.id);
                  close();
                }}
              >
                <span className="picker-row__meta">
                  <span className="picker-row__name">{w.name}</span>
                  <span className="picker-row__sub t-data-s">{shortAddress(primaryAddress(w))}</span>
                </span>
                {selected && <Icon src={checkIcon} size={24} color="var(--status-success)" />}
              </button>
            </li>
          );
        })}
      </ul>
      <Button block onClick={() => navigate("wallets")}>
        {t("walletSettings")}
      </Button>
    </Dropdown>
  );
}
