import { useState } from "react";
import type { WalletSummary } from "../../../../src/web/contract";
import { errorMessage } from "../../api/client";
import { usePortfolio, useSetTokenVisibility, useTokenList } from "../../api/queries";
import { Modal } from "../../components/Modal";
import { TokenIcon } from "../../components/TokenIcon";
import { Toggle } from "../../components/Toggle";
import { t } from "../../i18n";
import { formatAmount, formatUsd } from "../../money";
import { networkName, walletNetworks } from "../../networks";
import { TokenFilters } from "./TokenFilters";
import { nativeIcons, useDebounced } from "./tokens";

interface TokensDialogProps {
  wallet: WalletSummary;
  onClose: () => void;
}

/** Catalog of the wallet's networks with a show/hide switch per token (manager display only). */
export function TokensDialog({ wallet, onClose }: TokensDialogProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const q = useDebounced(query.trim(), 250);
  const list = useTokenList(wallet.id, selected, q);
  const portfolio = usePortfolio(wallet.id);
  const setVisibility = useSetTokenVisibility(wallet.id);
  /** Switch positions while the PUT is in flight, so the toggle moves on click. */
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const toggle = (network: string, assetId: string, key: string, visible: boolean) => {
    setPending((p) => ({ ...p, [key]: visible }));
    setVisibility.mutate(
      { network, assetId, visible },
      {
        onSettled: () =>
          setPending((p) => {
            const { [key]: _, ...rest } = p;
            return rest;
          }),
      },
    );
  };

  const tokens = list.data?.tokens ?? [];
  const failed = list.data?.errors.map((e) => networkName(e.network)) ?? [];
  const loading = list.data?.pending.map(networkName) ?? [];

  return (
    <Modal title={t("tokensTitle")} layout="list" width={560} className="tokens-dialog" onClose={onClose}>
      <TokenFilters
        variant="dialog"
        query={query}
        onQuery={setQuery}
        networks={walletNetworks(wallet.addresses)}
        selected={selected}
        onSelected={setSelected}
        fallbackIcons={nativeIcons(portfolio.data?.tokens ?? [])}
      />
      {failed.length > 0 && (
        <p className="tokens-dialog__hint t-paragraph-s">{t("tokensBalancesMissing", { networks: failed.join(", ") })}</p>
      )}
      {loading.length > 0 && (
        <p className="tokens-dialog__hint t-paragraph-s">{t("tokensBalancesLoading", { networks: loading.join(", ") })}</p>
      )}
      {setVisibility.isError && <p className="form-error t-paragraph-s">{errorMessage(setVisibility.error)}</p>}
      <div className="tokens-dialog__card" aria-busy={list.isFetching}>
        {list.isPending && <p className="tokens-dialog__status t-paragraph-m">{t("loading")}</p>}
        {list.isError && <p className="form-error t-paragraph-s">{errorMessage(list.error)}</p>}
        {list.data && tokens.length === 0 && (
          <p className="tokens-dialog__status t-paragraph-m">{t("tokensNothingFound")}</p>
        )}
        {tokens.length > 0 && (
          <ul className="token-toggle-list">
            {tokens.map((token) => {
              const visible = pending[token.key] ?? token.visible;
              return (
                <li key={token.key} className="token-toggle">
                  <TokenIcon src={token.icon} label={token.symbol} size={40} />
                  <span className="token-toggle__meta">
                    <span className="token-toggle__name t-label-l">{token.name}</span>
                    <span className="token-toggle__sub t-body-m">
                      {token.symbol} · {token.standard ?? networkName(token.network)}
                    </span>
                  </span>
                  {token.balance !== null && Number(token.balance) > 0 && (
                    <span className="token-toggle__amount">
                      <span className="t-label-l">{formatAmount(token.balance, token.displayDecimals)}</span>
                      {token.usdValue !== null && (
                        <span className="token-toggle__value t-body-m">{formatUsd(token.usdValue)}</span>
                      )}
                    </span>
                  )}
                  <Toggle
                    checked={visible}
                    label={t(visible ? "tokenHide" : "tokenShow", { name: `${token.symbol} ${networkName(token.network)}` })}
                    onChange={(next) => toggle(token.network, token.assetId, token.key, next)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {list.data && list.data.total > tokens.length && (
        <p className="tokens-dialog__hint t-paragraph-s">
          {t("tokensLimited", { shown: tokens.length, total: list.data.total })}
        </p>
      )}
    </Modal>
  );
}
