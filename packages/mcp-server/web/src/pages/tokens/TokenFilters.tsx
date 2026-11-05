import { useState } from "react";
import filterIcon from "../../assets/icon-filter.svg";
import searchIcon from "../../assets/icon-search.svg";
import { ChipRow } from "../../components/ChipRow";
import { Icon } from "../../components/Icon";
import { t } from "../../i18n";
import { networkName } from "../../networks";
import { NetworkFilterDialog } from "./NetworkFilterDialog";

interface TokenFiltersProps {
  query: string;
  onQuery: (query: string) => void;
  /** Networks of the wallet, in chip order. */
  networks: string[];
  /** Empty means every network. */
  selected: string[];
  onSelected: (selected: string[]) => void;
  fallbackIcons: Record<string, string | null>;
  /** "dialog" puts the search field on a tinted surface (it sits on white). */
  variant: "page" | "dialog";
}

/** Search field, network filter button with a count badge, and a row of network chips. */
export function TokenFilters({
  query,
  onQuery,
  networks,
  selected,
  onSelected,
  fallbackIcons,
  variant,
}: TokenFiltersProps) {
  const [filterOpen, setFilterOpen] = useState(false);

  const toggleChip = (network: string) => {
    const next = selected.includes(network) ? selected.filter((n) => n !== network) : [...selected, network];
    onSelected(next.length === networks.length ? [] : next);
  };

  return (
    <>
      <div className="search-row">
        <label className={`search-field search-field--${variant}`}>
          <Icon src={searchIcon} size={20} color="var(--text-tertiary)" />
          <input
            type="search"
            className="search-field__input t-body-l"
            placeholder={t("search")}
            aria-label={t("search")}
            value={query}
            maxLength={100}
            onChange={(e) => onQuery(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="filter-button"
          onClick={() => setFilterOpen(true)}
          aria-label={t("networkFilter")}
        >
          <Icon src={filterIcon} size={24} color="var(--text-accent)" />
          {selected.length > 0 && <span className="filter-button__badge">{selected.length}</span>}
        </button>
      </div>
      <ChipRow label={t("networkFilter")}>
        <button
          type="button"
          className={selected.length === 0 ? "chip chip--selected" : "chip"}
          aria-pressed={selected.length === 0}
          onClick={() => onSelected([])}
        >
          {t("all")}
        </button>
        {networks.map((network) => (
          <button
            key={network}
            type="button"
            className={selected.includes(network) ? "chip chip--selected" : "chip"}
            aria-pressed={selected.includes(network)}
            onClick={() => toggleChip(network)}
          >
            {networkName(network)}
          </button>
        ))}
      </ChipRow>
      {filterOpen && (
        <NetworkFilterDialog
          networks={networks}
          selected={selected}
          fallbackIcons={fallbackIcons}
          onApply={(next) => {
            onSelected(next);
            setFilterOpen(false);
          }}
          onClose={() => setFilterOpen(false)}
        />
      )}
    </>
  );
}
