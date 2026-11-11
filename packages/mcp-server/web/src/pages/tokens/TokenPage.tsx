import type { WalletSummary } from "../../../../src/web/contract";
import { usePortfolio } from "../../api/queries";
import receiveIcon from "../../assets/icon-receive.svg";
import { Button } from "../../components/Button";
import { CopyButton } from "../../components/CopyButton";
import { Icon } from "../../components/Icon";
import { ScreenHeader } from "../../components/ScreenHeader";
import { t } from "../../i18n";
import { formatAmount, formatUsd } from "../../money";
import { networkName } from "../../networks";
import { href, navigate } from "../../router";
import { HistoryFeed } from "../history/HistoryFeed";
import { WalletGate } from "../home/WalletGate";
import { shortAddress } from "../wallets/format";

/** `#/tokens/<network>/<assetId>`: one token of the selected wallet. */
export function TokenPage({ network, assetId }: { network: string; assetId: string }) {
  return <WalletGate>{(wallet) => <Token wallet={wallet} network={network} assetId={assetId} />}</WalletGate>;
}

function Token({ wallet, network, assetId }: { wallet: WalletSummary; network: string; assetId: string }) {
  const portfolio = usePortfolio(wallet.id);
  const token = portfolio.data?.tokens.find((tk) => tk.network === network && tk.assetId === assetId);
  const address = wallet.addresses[network];

  if (portfolio.isPending) return <p className="page__status t-paragraph-m">{t("loading")}</p>;
  if (!token || !address) {
    return (
      <div className="page">
        <ScreenHeader title={t("navTokens")} backHref={href("home")} />
        <p className="page__status t-paragraph-m">{t("tokenNotShown")}</p>
      </div>
    );
  }

  return (
    <div className="page token-page">
      <ScreenHeader
        backHref={href("home")}
        title={
          <>
            {token.symbol} <span className="token-page__network">{networkName(token.network)}</span>
          </>
        }
      />
      <CopyButton value={address} className="address-chip t-data-m">
        {shortAddress(address)}
      </CopyButton>
      <p className="token-page__balance">
        <span className="t-display-m">
          {token.balance === null ? "—" : formatAmount(token.balance, token.displayDecimals)} {token.symbol}
        </span>
        {token.usdValue !== null && <span className="token-page__usd t-h2">~{formatUsd(token.usdValue)}</span>}
      </p>
      <Button className="token-page__receive" onClick={() => navigate("home", "receive", token.network, token.assetId)}>
        <Icon src={receiveIcon} size={24} color="currentColor" />
        {t("receive")}
      </Button>
      <h2 className="token-page__tx-title t-h2">{t("transactions")}</h2>
      <HistoryFeed
        walletId={wallet.id}
        network={token.network}
        filter={(item) => item.asset.assetId === token.assetId}
        hrefFor={(item) => href("tokens", token.network, token.assetId, "tx", item.id)}
        emptyText={t("tokenNoTx", { symbol: token.symbol })}
        centered
      />
      <p className="footer-note t-paragraph-s">{t("footerNote")}</p>
    </div>
  );
}
