import type { HistoryItemView } from "../../../../src/web/contract";
import { Icon } from "../../components/Icon";
import { t } from "../../i18n";
import { assetTitle, counterparty, DIRECTION_ICON, groupByDay, signedAmount, STATUS } from "./history";

interface TxRowProps {
  item: HistoryItemView;
  network: string;
  href: string;
}

/** Tx card: direction icon, asset and status on the left; amount, Details and counterparty on the right. */
export function TxRow({ item, network, href }: TxRowProps) {
  const { main, suffix } = assetTitle(item, network);
  const icon = DIRECTION_ICON[item.direction];
  const status = STATUS[item.status];
  const other = counterparty(item);
  return (
    <a className="tx-row" href={href}>
      <span className="tx-row__icon">
        <Icon src={icon.src} size={item.direction === "self" ? 24 : 32} color={icon.color} />
      </span>
      <span className="tx-row__meta">
        <span className="tx-row__asset">
          <span className="t-label-l">{main}</span> <span className="tx-row__suffix t-body-m">({suffix})</span>
        </span>
        <span className={`tx-status ${status.className} t-body-m`}>{t(status.label)}</span>
        {item.asset.warning && <span className="tx-row__warning t-body-m">{t("txSpam")}</span>}
      </span>
      <span className="tx-row__side">
        <span className={item.direction === "in" ? "tx-row__amount tx-row__amount--in t-label-l" : "tx-row__amount t-label-l"}>
          {signedAmount(item)}
        </span>
        <span className="tx-row__details t-label-m">{t("txDetails")}</span>
        {other && <span className="tx-row__other t-body-m">{other}</span>}
      </span>
    </a>
  );
}

interface TxListProps {
  items: HistoryItemView[];
  network: string;
  hrefFor: (item: HistoryItemView) => string;
  /** Token page: day captions centred over the cards. */
  centered?: boolean;
}

export function TxList({ items, network, hrefFor, centered = false }: TxListProps) {
  return (
    <div className={centered ? "tx-list tx-list--centered" : "tx-list"}>
      {groupByDay(items).map((group) => (
        <section key={group.label} className="tx-group">
          <h2 className="tx-group__label t-body-m">{group.label}</h2>
          <ul className="tx-group__items">
            {group.items.map((item) => (
              <li key={item.id}>
                <TxRow item={item} network={network} href={hrefFor(item)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
