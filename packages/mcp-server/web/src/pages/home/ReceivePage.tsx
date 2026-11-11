import { useState } from "react";
import type { TokenView, WalletSummary } from "../../../../src/web/contract";
import { usePortfolio } from "../../api/queries";
import { CopyButton } from "../../components/CopyButton";
import { Logo } from "../../components/Logo";
import { ScreenHeader } from "../../components/ScreenHeader";
import { TokenRow } from "../../components/TokenRow";
import { t } from "../../i18n";
import { formatAmount, formatUsd } from "../../money";
import { networkName, walletNetworks } from "../../networks";
import { href, navigate } from "../../router";
import { TokenFilters } from "../tokens/TokenFilters";
import { matchesQuery, nativeIcons, sortTokens } from "../tokens/tokens";
import { WalletGate } from "./WalletGate";

/** `#/home/receive` lists the shown tokens; `#/home/receive/<network>/<assetId>` is the QR card. */
export function ReceivePage({ network, assetId }: { network?: string; assetId?: string }) {
  return (
    <WalletGate>
      {(wallet) =>
        network && assetId ? (
          <ReceiveCard wallet={wallet} network={network} assetId={assetId} />
        ) : (
          <ReceivePicker wallet={wallet} />
        )
      }
    </WalletGate>
  );
}

function ReceivePicker({ wallet }: { wallet: WalletSummary }) {
  const portfolio = usePortfolio(wallet.id);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const all = portfolio.data?.tokens ?? [];
  const tokens = sortTokens(
    all.filter((tk) => (selected.length === 0 || selected.includes(tk.network)) && matchesQuery(tk, query)),
    "value",
  );

  return (
    <div className="page receive-picker">
      <ScreenHeader title={t("receiveChooseTitle")} backHref={href("home")} />
      <TokenFilters
        variant="page"
        query={query}
        onQuery={setQuery}
        networks={walletNetworks(wallet.addresses)}
        selected={selected}
        onSelected={setSelected}
        fallbackIcons={nativeIcons(all)}
      />
      {portfolio.isPending && <p className="page__status t-paragraph-m">{t("loading")}</p>}
      {portfolio.data && tokens.length === 0 && (
        <p className="page__status t-paragraph-m">{t("tokensNothingFound")}</p>
      )}
      {tokens.length > 0 && (
        <ul className="token-list receive-picker__list">
          {tokens.map((token) => (
            <li key={token.key}>
              <TokenRow
                token={token}
                onClick={() => navigate("home", "receive", token.network, token.assetId)}
              />
            </li>
          ))}
        </ul>
      )}
      <p className="footer-note t-paragraph-s">{t("footerNote")}</p>
    </div>
  );
}

/** "ETH (Ethereum)": what the caption and the warning call the asset. */
function assetLabel(token: TokenView): string {
  return `${token.symbol} (${networkName(token.network)})`;
}

function ReceiveCard({ wallet, network, assetId }: { wallet: WalletSummary; network: string; assetId: string }) {
  const portfolio = usePortfolio(wallet.id);
  const token = portfolio.data?.tokens.find((tk) => tk.network === network && tk.assetId === assetId);
  const address = wallet.addresses[network];
  const back = href("home", "receive");

  if (portfolio.isPending) return <p className="page__status t-paragraph-m">{t("loading")}</p>;
  if (!token || !address) {
    return (
      <div className="page receive">
        <ScreenHeader title={t("receive")} backHref={back} />
        <p className="page__status t-paragraph-m">{t("tokenNotShown")}</p>
      </div>
    );
  }

  const qr = `qr?${new URLSearchParams({ network, address, plain: "1" })}`;
  const [before, after = ""] = t("receiveWarning").split("{asset}");

  return (
    <div className="page receive">
      <ScreenHeader title={t("receiveTitle", { name: token.name })} backHref={back} />
      <div className="receive-card">
        <div className="receive-card__brand">
          <Logo variant="header" />
        </div>
        <img className="receive-card__qr" src={qr} width={232} height={232} alt={t("receiveQrAlt", { asset: assetLabel(token) })} />
        <div className="receive-card__divider">
          <span className="receive-card__line" />
          <span className="t-body-s">{t("receiveAddressCaption", { asset: assetLabel(token) })}</span>
          <span className="receive-card__line" />
        </div>
        <CopyButton value={address} className="receive-card__address t-data-s">
          {address}
        </CopyButton>
      </div>
      <p className="receive__amount t-body-m">
        <span className="receive__amount-coin">
          {token.balance === null ? "—" : formatAmount(token.balance, token.displayDecimals)} {token.symbol}
        </span>
        {token.usdValue !== null && <span className="receive__amount-usd">≈ {formatUsd(token.usdValue)}</span>}
      </p>
      <p className="receive__warning">
        {before}
        <strong>{assetLabel(token)}</strong>
        {after}
      </p>
      <p className="footer-note footer-note--receive t-paragraph-s">{t("footerNote")}</p>
    </div>
  );
}
