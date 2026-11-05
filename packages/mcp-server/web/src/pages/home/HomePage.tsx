import { useState } from "react";
import type { WalletSummary } from "../../../../src/web/contract";
import { errorMessage } from "../../api/client";
import { usePortfolio, usePrefs, useRefreshPortfolio } from "../../api/queries";
import chevronDown16 from "../../assets/icon-chevron-down-16.svg";
import plusIcon from "../../assets/icon-plus.svg";
import receiveIcon from "../../assets/icon-receive.svg";
import refreshIcon from "../../assets/icon-refresh.svg";
import mascot from "../../assets/mascot.gif";
import { Button } from "../../components/Button";
import { CopyButton } from "../../components/CopyButton";
import { Icon } from "../../components/Icon";
import { Notice } from "../../components/Notice";
import { RetryButton } from "../../components/RetryButton";
import { TokenRow } from "../../components/TokenRow";
import { t } from "../../i18n";
import { formatUsd } from "../../money";
import { networkName } from "../../networks";
import { navigate } from "../../router";
import { TokensDialog } from "../tokens/TokensDialog";
import { hasBalance, sortTokens } from "../tokens/tokens";
import { primaryAddress, shortAddress } from "../wallets/format";
import { SortMenu } from "./SortMenu";
import { WalletGate } from "./WalletGate";
import { WalletPicker } from "./WalletPicker";

const PAGE_SIZE = 10;

/** `#/home` (and `#/tokens`, which opens the Tokens dialog over it). */
export function HomePage({ tokensOpen }: { tokensOpen: boolean }) {
  return (
    <WalletGate>
      {(wallet, wallets) => <Home key={wallet.id} wallet={wallet} wallets={wallets} tokensOpen={tokensOpen} />}
    </WalletGate>
  );
}

interface HomeProps {
  wallet: WalletSummary;
  wallets: WalletSummary[];
  tokensOpen: boolean;
}

function Home({ wallet, wallets, tokensOpen }: HomeProps) {
  const portfolio = usePortfolio(wallet.id);
  const refresh = useRefreshPortfolio(wallet.id);
  const prefs = usePrefs();
  const [shown, setShown] = useState(PAGE_SIZE);

  const sort = prefs.data?.tokenSort ?? "value";
  const showZero = prefs.data?.showZeroBalances ?? true;
  const all = portfolio.data?.tokens ?? [];
  const tokens = sortTokens(showZero ? all : all.filter(hasBalance), sort);
  const failed = portfolio.data?.errors.map((e) => networkName(e.network)) ?? [];
  const loading = portfolio.data?.pending.map(networkName) ?? [];
  const refreshing = refresh.isPending || loading.length > 0;
  const address = primaryAddress(wallet);

  return (
    <div className="page home">
      <div className="home__wallet">
        <img className="home__mascot" src={mascot} alt="" width={87} height={53} />
        <WalletPicker wallets={wallets} current={wallet} />
      </div>
      <p className="home__balance t-display-l" aria-busy={portfolio.isPending}>
        {portfolio.data ? formatUsd(portfolio.data.totalUsd) : "…"}
      </p>
      <div className="home__address">
        <CopyButton value={address} className="t-data-m">
          {shortAddress(address)}
        </CopyButton>
      </div>
      <Button block onClick={() => navigate("home", "receive")}>
        <Icon src={receiveIcon} size={24} color="currentColor" />
        {t("receive")}
      </Button>
      <div className="info-card">
        <p className="info-card__title">{t("homeInfoTitle")}</p>
        <p className="info-card__text t-paragraph-m">{t("homeInfoText")}</p>
      </div>

      {failed.length > 0 && (
        <Notice>
          <p>{t("homeBalancesMissing", { networks: failed.join(", ") })}</p>
          <RetryButton busy={portfolio.isFetching} onClick={() => void portfolio.refetch()} />
        </Notice>
      )}
      {portfolio.isError && (
        <Notice tone="danger">
          <p>
            {t("homePortfolioFailed")} {errorMessage(portfolio.error)}
          </p>
          <RetryButton busy={portfolio.isFetching} onClick={() => void portfolio.refetch()} />
        </Notice>
      )}
      {refresh.isError && !portfolio.isError && (
        <Notice tone="danger">
          <p>
            {t("homeRefreshFailed")} {errorMessage(refresh.error)}
          </p>
          <RetryButton busy={refreshing} onClick={() => refresh.mutate()} />
        </Notice>
      )}

      <div className="home__toolbar">
        <button
          type="button"
          className="toolbar-button toolbar-button--compact"
          disabled={refreshing}
          aria-busy={refreshing}
          aria-label={t("refreshBalances")}
          onClick={() => refresh.mutate()}
        >
          <Icon
            src={refreshIcon}
            size={24}
            color="var(--text-accent)"
            className={refreshing ? "toolbar-button__spin" : undefined}
          />
          <span className="toolbar-button__label">{t("refreshBalances")}</span>
        </button>
        <SortMenu sort={sort} showZero={showZero} />
        <button type="button" className="toolbar-button" onClick={() => navigate("tokens")}>
          <Icon src={plusIcon} size={24} color="var(--text-accent)" />
          {t("addTokens")}
        </button>
      </div>

      {portfolio.isPending && <p className="page__status t-paragraph-m">{t("loading")}</p>}
      {loading.length > 0 && (
        <p className="page__status t-paragraph-s">{t("homeBalancesLoading", { networks: loading.join(", ") })}</p>
      )}
      {portfolio.data?.ratesPending && <p className="page__status t-paragraph-s">{t("homePricesLoading")}</p>}
      {portfolio.data && tokens.length === 0 && (
        <p className="page__status t-paragraph-m">{t(all.length === 0 ? "homeNoTokens" : "homeOnlyZero")}</p>
      )}
      {tokens.length > 0 && (
        <ul className="token-list">
          {tokens.slice(0, shown).map((token) => (
            <li key={token.key}>
              <TokenRow
                promo
                token={token}
                onClick={() => navigate("tokens", token.network, token.assetId)}
              />
            </li>
          ))}
        </ul>
      )}
      {tokens.length > shown && (
        <button type="button" className="load-more" onClick={() => setShown(shown + PAGE_SIZE)}>
          <Icon src={chevronDown16} size={16} color="var(--text-accent)" />
          {t("loadMore")}
        </button>
      )}
      <p className="footer-note t-paragraph-s">{t("footerNote")}</p>

      {tokensOpen && <TokensDialog wallet={wallet} onClose={() => navigate("home")} />}
    </div>
  );
}
