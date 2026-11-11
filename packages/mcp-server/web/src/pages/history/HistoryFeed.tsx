import { useEffect, useRef } from "react";
import type { HistoryItemView } from "../../../../src/web/contract";
import { errorMessage } from "../../api/client";
import { HistoryUnavailableError, useHistory } from "../../api/queries";
import chevronDown16 from "../../assets/icon-chevron-down-16.svg";
import { Icon } from "../../components/Icon";
import { Notice } from "../../components/Notice";
import { RetryButton } from "../../components/RetryButton";
import { t } from "../../i18n";
import { networkName } from "../../networks";
import { historyItems } from "./history";
import { TxList } from "./TxList";

const BALANCE_SITE = "cryptowallet-balance.com";
/** Hide rows with asset.warning and skip pages made only of them. Off until it becomes a setting. */
const HIDE_SPAM = false;
/**
 * Pages whose rows are all hidden are skipped automatically, at most this many
 * in a row: each page costs several explorer calls, and spam can fill a whole history.
 */
const AUTO_SKIP_PAGES = 2;

/** Explorers failed: retry inline in the sentence, plus a site that shows the same data. */
function UnavailableNotice({ network, busy, onRetry }: { network: string; busy: boolean; onRetry: () => void }) {
  const [before, after = ""] = t("historyUnavailable", { network: networkName(network) }).split("{retry}");
  const [altBefore, altAfter = ""] = t("historyAlternative").split("{site}");
  return (
    <Notice size="m" bordered title={t("historyUnavailableTitle")}>
      <p>
        {before}
        <button
          type="button"
          className="notice__link notice__link--inline"
          disabled={busy}
          aria-busy={busy}
          onClick={onRetry}
        >
          {t("historyRetry")}
        </button>
        {after}
      </p>
      <hr className="notice__divider" />
      <p>
        {altBefore}
        <a
          className="notice__link notice__link--inline"
          href={`https://${BALANCE_SITE}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {BALANCE_SITE}
        </a>
        {altAfter}
      </p>
    </Notice>
  );
}

interface HistoryFeedProps {
  walletId: string;
  network: string;
  hrefFor: (item: HistoryItemView) => string;
  /** Token page: only this asset's rows (pages still hold every asset of the network). */
  filter?: (item: HistoryItemView) => boolean;
  emptyText: string;
  centered?: boolean;
}

/** Pages of one network's history with loading, outage and Load more states. */
export function HistoryFeed({ walletId, network, hrefFor, filter, emptyText, centered }: HistoryFeedProps) {
  const history = useHistory(walletId, network);
  const pages = history.data?.pages;
  const first = pages?.[0];
  // Rows flagged as spam stay in the API (the agent still sees asset.warning); only this list hides them.
  const shown = (it: HistoryItemView) => !(HIDE_SPAM && it.asset.warning) && (!filter || filter(it));
  const items = historyItems(pages).filter(shown);
  const refetching = history.isFetching && !history.isFetchingNextPage;
  const pageFailed = history.isFetchNextPageError;

  const lastPageHidden = HIDE_SPAM && !!pages?.length && !pages[pages.length - 1].items.some(shown);
  const skipped = useRef(0);
  useEffect(() => {
    skipped.current = 0;
  }, [walletId, network]);
  useEffect(() => {
    if (!lastPageHidden) {
      skipped.current = 0;
      return;
    }
    if (!history.hasNextPage || history.isFetching || pageFailed || skipped.current >= AUTO_SKIP_PAGES) return;
    skipped.current++;
    void history.fetchNextPage();
  }, [lastPageHidden, history.hasNextPage, history.isFetching, pageFailed, history.fetchNextPage]);
  const loadMore = () => {
    skipped.current = 0;
    void history.fetchNextPage();
  };

  if (history.isPending) return <p className="page__status t-paragraph-m">{t("loading")}</p>;
  if (history.isError && !history.data) {
    return (
      <Notice tone="danger">
        <p>
          {t("historyFailed")} {errorMessage(history.error)}
        </p>
        <RetryButton busy={refetching} onClick={() => void history.refetch()} />
      </Notice>
    );
  }
  if (first?.status === "unsupported") {
    return <p className="page__status t-paragraph-m">{t("historyUnsupported", { network: networkName(network) })}</p>;
  }
  if (first?.status === "unavailable") {
    return <UnavailableNotice network={network} busy={refetching} onRetry={() => void history.refetch()} />;
  }

  const skipping = HIDE_SPAM && items.length === 0 && history.isFetchingNextPage;
  return (
    <>
      {items.length > 0 ? (
        <TxList items={items} network={network} hrefFor={hrefFor} centered={centered} />
      ) : (
        <p className="page__status t-paragraph-m">{skipping ? t("loading") : emptyText}</p>
      )}
      {pageFailed &&
        (history.error instanceof HistoryUnavailableError ? (
          <UnavailableNotice
            network={network}
            busy={history.isFetchingNextPage}
            onRetry={loadMore}
          />
        ) : (
          <Notice>
            <p>
              {t("historyFailed")} {errorMessage(history.error)}
            </p>
            <RetryButton busy={history.isFetchingNextPage} onClick={loadMore} />
          </Notice>
        ))}
      {history.hasNextPage && !pageFailed && !skipping && (
        <button type="button" className="load-more" disabled={history.isFetchingNextPage} onClick={loadMore}>
          <Icon src={chevronDown16} size={16} color="var(--text-accent)" />
          {history.isFetchingNextPage ? t("loading") : t("loadMore")}
        </button>
      )}
    </>
  );
}