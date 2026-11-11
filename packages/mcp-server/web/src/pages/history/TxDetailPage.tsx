import type { ReactNode } from "react";
import type { HistoryItemView, WalletSummary } from "../../../../src/web/contract";
import { useHistory } from "../../api/queries";
import linkIcon from "../../assets/icon-link.svg";
import { ActionRow } from "../../components/ActionRow";
import { CopyButton } from "../../components/CopyButton";
import { Notice } from "../../components/Notice";
import { ScreenHeader } from "../../components/ScreenHeader";
import { t } from "../../i18n";
import { networkName } from "../../networks";
import { WalletGate } from "../home/WalletGate";
import { assetTitle, detailTitle, formatTxDate, historyItems, STATUS } from "./history";

interface TxDetailPageProps {
  network: string;
  id: string;
  /** The list this row was opened from (History or a Token page). */
  backHref: string;
}

/** `#/history/<network>/tx/<id>` and `#/tokens/<network>/<asset>/tx/<id>`. */
export function TxDetailPage(props: TxDetailPageProps) {
  return <WalletGate>{(wallet) => <TxDetail wallet={wallet} {...props} />}</WalletGate>;
}

function TxDetail({ wallet, network, id, backHref }: TxDetailPageProps & { wallet: WalletSummary }) {
  const history = useHistory(wallet.id, wallet.addresses[network] ? network : "");
  const item = historyItems(history.data?.pages).find((it) => it.id === id);

  if (history.isLoading) return <p className="page__status t-paragraph-m">{t("loading")}</p>;
  if (!item) {
    return (
      <div className="page">
        <ScreenHeader title={t("txTitle")} backHref={backHref} />
        <p className="page__status t-paragraph-m">{t("txNotFound")}</p>
      </div>
    );
  }
  return <Detail item={item} network={network} backHref={backHref} />;
}

function Detail({ item, network, backHref }: { item: HistoryItemView; network: string; backHref: string }) {
  const { main, suffix } = assetTitle(item, network);
  const status = STATUS[item.status];
  const sign = item.direction === "in" ? "+ " : item.direction === "out" ? "- " : "";

  return (
    <div className="page tx-detail">
      <ScreenHeader title={t(detailTitle(item))} backHref={backHref} />
      <div className="tx-detail__hero">
        <p className="tx-detail__asset t-body-l">
          {main} <span className="tx-detail__suffix">({suffix})</span>
        </p>
        <p className="tx-detail__amount t-display-m">
          {sign}
          {item.amount}
        </p>
      </div>

      {item.asset.warning && (
        <Notice tone="danger">
          <p>{t("txSpamWarning")}</p>
        </Notice>
      )}

      <dl className="tx-card t-body-l">
        <Row label={t("txStatus")}>
          <span className={`tx-status ${status.className}`}>{t(status.label)}</span>
        </Row>
        {item.timestamp && <Row label={t("txDate")}>{formatTxDate(item.timestamp)}</Row>}
        <Row label={t("txNetwork")}>{networkName(network)}</Row>
        {item.fee && (
          <Row label={t("txFee")}>
            {item.fee.amount} {item.fee.symbol}
          </Row>
        )}
      </dl>

      <dl className="tx-card t-body-l">
        {item.from && <CopyRow label={t("txFrom")} value={item.from} copyLabel={t("copyAddress")} />}
        {item.to && <CopyRow label={t("txTo")} value={item.to} copyLabel={t("copyAddress")} />}
        <CopyRow label={t("txHash")} value={item.hash} copyLabel={t("copyHash")} />
      </dl>

      <div className="tx-detail__actions">
        <ActionRow
          icon={linkIcon}
          label={t("txExplorer")}
          onClick={() => window.open(item.explorerUrl, "_blank", "noopener,noreferrer")}
        />
      </div>
      <p className="footer-note t-paragraph-s">{t("footerNote")}</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tx-card__row">
      <dt className="tx-card__label">{label}</dt>
      <dd className="tx-card__value t-label-l">{children}</dd>
    </div>
  );
}

function CopyRow({ label, value, copyLabel }: { label: string; value: string; copyLabel: string }) {
  return (
    <div className="tx-card__row">
      <dt className="tx-card__label">{label}</dt>
      <dd className="tx-card__copy">
        <CopyButton value={value} label={copyLabel} className="tx-card__copy-button t-data-m">
          <span className="tx-card__mono">{value}</span>
        </CopyButton>
      </dd>
    </div>
  );
}
