import { useState } from "react";
import checkIcon from "../../assets/icon-check.svg";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { NetworkLogo } from "../../components/NetworkLogo";
import { t } from "../../i18n";
import { networkName } from "../../networks";

interface NetworkFilterDialogProps {
  networks: string[];
  /** Empty means every network. */
  selected: string[];
  fallbackIcons: Record<string, string | null>;
  onApply: (selected: string[]) => void;
  onClose: () => void;
}

/** Multi-select of networks, alphabetical as in the design; applies on "Apply" only. */
export function NetworkFilterDialog({ networks, selected, fallbackIcons, onApply, onClose }: NetworkFilterDialogProps) {
  const [draft, setDraft] = useState(() => new Set(selected));
  const sorted = [...networks].sort((a, b) => networkName(a).localeCompare(networkName(b)));

  const toggle = (network: string) => {
    const next = new Set(draft);
    if (next.has(network)) next.delete(network);
    else next.add(network);
    setDraft(next);
  };

  return (
    <Modal title={t("networkTitle")} layout="list" width={560} className="network-dialog" onClose={onClose}>
      <div className="network-dialog__bar">
        <button type="button" className="link-button t-label-m" onClick={() => setDraft(new Set(networks))}>
          {t("selectAll")}
        </button>
      </div>
      <ul className="network-dialog__list">
        {sorted.map((network) => {
          const on = draft.has(network);
          return (
            <li key={network}>
              <label className={on ? "network-option network-option--on" : "network-option"}>
                <NetworkLogo network={network} size={32} fallback={fallbackIcons[network]} />
                <span className="network-option__name t-body-m">{networkName(network)}</span>
                <input
                  type="checkbox"
                  className="checkbox__input"
                  checked={on}
                  onChange={() => toggle(network)}
                />
                <span className="network-option__box" aria-hidden="true">
                  {on && <Icon src={checkIcon} size={14} color="var(--text-on-accent)" />}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="network-dialog__actions">
        <Button variant="secondary" onClick={onClose}>
          {t("back")}
        </Button>
        <Button onClick={() => onApply(draft.size === networks.length ? [] : [...draft])}>{t("apply")}</Button>
      </div>
    </Modal>
  );
}
