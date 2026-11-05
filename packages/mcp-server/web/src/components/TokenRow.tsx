import type { TokenView } from "../../../src/web/contract";
import { t } from "../i18n";
import { formatAmount, formatChange, formatPrice, formatUsd } from "../money";
import { TokenIcon } from "./TokenIcon";

/** Networks where sending runs on the discounted fee; the promo covers the native coin and every token. */
const FEE_PROMO_NETWORKS = new Set(["tron"]);

/**
 * The grey "(…)" after a token name: its standard (ERC20, TRC20…). Native
 * coins have none; the catalog already names them "ETH (Base)" and so on.
 */
function nameSuffix(token: TokenView): string | null {
  return token.standard && token.standard !== token.name ? token.standard : null;
}

interface TokenRowProps {
  token: TokenView;
  onClick: () => void;
  /** Show the network-fee promo on networks that have one. */
  promo?: boolean;
}

/** Portfolio card as in the mobile app: icon with ticker, name and price, balance and value. */
export function TokenRow({ token, onClick, promo = false }: TokenRowProps) {
  const change = token.change24h;
  const suffix = nameSuffix(token);
  const feePromo = promo && FEE_PROMO_NETWORKS.has(token.network);
  return (
    <button type="button" className={feePromo ? "token-card token-card--promo" : "token-card"} onClick={onClick}>
      {feePromo && (
        <span className="token-card__promo">
          <span className="token-card__pill t-label-s">{t("feePromo")}</span>
          <span className="token-card__bolt" aria-hidden="true">
            ⚡
          </span>
        </span>
      )}
      <span className="token-card__row">
        <span className="token-card__icon">
          <TokenIcon src={token.icon} label={token.symbol} size={42} />
          <span className="token-card__symbol t-label-s">{token.symbol}</span>
        </span>
        <span className="token-card__meta">
          <span className="token-card__name t-label-l">
            {token.name}
            {suffix && <span className="token-card__standard"> ({suffix})</span>}
          </span>
          {token.usdPrice !== null && (
            <span className="token-card__price t-body-m">
              {formatPrice(token.usdPrice)}
              {change !== null && (
                <span className={change < 0 ? "token-card__change--down" : "token-card__change--up"}>
                  {formatChange(change)}
                </span>
              )}
            </span>
          )}
        </span>
        <span className="token-card__amount">
          <span className="token-card__balance t-label-l">
            {token.balance === null ? "—" : formatAmount(token.balance, token.displayDecimals)}
          </span>
          {token.usdValue !== null && <span className="token-card__value t-body-m">{formatUsd(token.usdValue)}</span>}
        </span>
      </span>
    </button>
  );
}
