import type { ReactNode } from "react";
import type { WalletSummary } from "../../../../src/web/contract";
import { errorMessage } from "../../api/client";
import { useWallets } from "../../api/queries";
import { Button } from "../../components/Button";
import { t } from "../../i18n";
import { navigate } from "../../router";

interface WalletGateProps {
  children: (wallet: WalletSummary, wallets: WalletSummary[]) => ReactNode;
}

/** Renders the page for the selected wallet, or loading / error / "add a wallet" states. */
export function WalletGate({ children }: WalletGateProps) {
  const wallets = useWallets();
  if (wallets.isPending) return <p className="page__status t-paragraph-m">{t("loading")}</p>;
  if (wallets.isError) {
    return (
      <p className="form-error t-paragraph-s">
        {t("walletsLoadFailed")} {errorMessage(wallets.error)}
      </p>
    );
  }
  const list = wallets.data.wallets;
  const wallet = list.find((w) => w.id === wallets.data.selectedId) ?? list[0];
  if (!wallet) {
    return (
      <div className="screen">
        <h1 className="screen__title t-h1">{t("homeEmptyTitle")}</h1>
        <p className="screen__caption t-body-l">{t("walletsEmpty")}</p>
        <div className="button-row home-empty__actions">
          <Button variant="secondary" size="m" onClick={() => navigate("wallets", "import")}>
            {t("walletsImport")}
          </Button>
          <Button size="m" onClick={() => navigate("wallets", "new")}>
            {t("walletsCreate")}
          </Button>
        </div>
      </div>
    );
  }
  return <>{children(wallet, list)}</>;
}
