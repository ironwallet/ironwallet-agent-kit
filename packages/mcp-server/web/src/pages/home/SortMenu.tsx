import { useCallback, useState } from "react";
import type { TokenSort } from "../../../../src/web/contract";
import { useUpdatePrefs } from "../../api/queries";
import checkIcon from "../../assets/icon-check-20.svg";
import sortIcon from "../../assets/icon-sort.svg";
import { Dropdown } from "../../components/Dropdown";
import { Icon } from "../../components/Icon";
import { Toggle } from "../../components/Toggle";
import { t, type MessageKey } from "../../i18n";

const OPTIONS: { sort: TokenSort; label: MessageKey }[] = [
  { sort: "name", label: "sortName" },
  { sort: "amount", label: "sortAmount" },
  { sort: "value", label: "sortValue" },
];

const DEFAULT_SORT: TokenSort = "value";

interface SortMenuProps {
  sort: TokenSort;
  showZero: boolean;
}

/** Sort order and the zero-balance filter; saved to the manager prefs on Apply. */
export function SortMenu({ sort, showZero }: SortMenuProps) {
  const [open, setOpen] = useState(false);
  const [draftSort, setDraftSort] = useState(sort);
  const [draftZero, setDraftZero] = useState(showZero);
  const update = useUpdatePrefs();
  const close = useCallback(() => setOpen(false), []);

  const toggleOpen = () => {
    if (!open) {
      setDraftSort(sort);
      setDraftZero(showZero);
    }
    setOpen(!open);
  };

  return (
    <Dropdown
      open={open}
      onClose={close}
      align="end"
      width={270}
      label={t("sortTitle")}
      className="sort-menu"
      trigger={
        <button
          type="button"
          className="toolbar-button toolbar-button--compact"
          aria-expanded={open}
          aria-label={t("sortTitle")}
          onClick={toggleOpen}
        >
          <Icon src={sortIcon} size={24} color="var(--text-accent)" />
          <span className="toolbar-button__label">{t("sort")}</span>
        </button>
      }
    >
      <p className="sort-menu__title">{t("sortTitle")}</p>
      <div className="sort-menu__zero">
        <span className="t-paragraph-s">{t("sortShowZero")}</span>
        <Toggle checked={draftZero} onChange={setDraftZero} label={t("sortShowZero")} />
      </div>
      <div className="sort-menu__options" role="radiogroup" aria-label={t("sortTitle")}>
        {OPTIONS.map((o) => {
          const on = o.sort === draftSort;
          return (
            <button
              key={o.sort}
              type="button"
              role="radio"
              aria-checked={on}
              className={on ? "sort-option sort-option--on" : "sort-option"}
              onClick={() => setDraftSort(o.sort)}
            >
              {t(o.label)}
              {on && <Icon src={checkIcon} size={20} color="var(--status-success)" />}
            </button>
          );
        })}
      </div>
      <div className="sort-menu__actions">
        <button
          type="button"
          className="sort-menu__reset"
          onClick={() => {
            setDraftSort(DEFAULT_SORT);
            setDraftZero(true);
          }}
        >
          {t("reset")}
        </button>
        <button
          type="button"
          className="sort-menu__apply"
          disabled={update.isPending}
          onClick={() =>
            update.mutate({ tokenSort: draftSort, showZeroBalances: draftZero }, { onSuccess: close })
          }
        >
          {t("apply")}
        </button>
      </div>
    </Dropdown>
  );
}
