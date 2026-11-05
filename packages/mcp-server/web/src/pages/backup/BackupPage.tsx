import { useState } from "react";
import { errorMessage } from "../../api/client";
import { usePortfolios, useWallets } from "../../api/queries";
import { Button } from "../../components/Button";
import { ScreenHeader } from "../../components/ScreenHeader";
import { t } from "../../i18n";
import { WalletRow } from "../wallets/WalletRow";
import { balanceLabel } from "../wallets/walletBalance";
import { BackupDialog } from "./BackupDialog";

/** `#/backup[/<walletId>]`: pick a wallet, then run the manual backup. */
export function BackupPage({ walletId }: { walletId?: string }) {
  const wallets = useWallets();
  const [picked, setPicked] = useState<string | undefined>(walletId);
  const [open, setOpen] = useState(false);

  const list = wallets.data?.wallets ?? [];
  const portfolios = usePortfolios(list.map((w) => w.id));
  const current = list.find((w) => w.id === (picked ?? wallets.data?.selectedId)) ?? list[0];

  return (
    <div className="page page--backup">
      <ScreenHeader title={t("backupTitle")} />
      <p className="page__caption t-body-l">{t("backupChoose")}</p>

      {wallets.isPending && <p className="page__status t-paragraph-m">{t("loading")}</p>}
      {wallets.isError && (
        <p className="form-error t-paragraph-s">
          {t("walletsLoadFailed")} {errorMessage(wallets.error)}
        </p>
      )}
      {wallets.data && list.length === 0 && <p className="page__status t-paragraph-m">{t("backupEmpty")}</p>}
      {current && (
        <>
          <ul className="wallet-list">
            {list.map((w, i) => (
              <WalletRow
                key={w.id}
                wallet={w}
                balance={balanceLabel(portfolios[i])}
                selected={w.id === current.id}
                onSelect={() => setPicked(w.id)}
                aside={!w.backedUp && <span className="tag t-label-s">{t("backupNotVerified")}</span>}
              />
            ))}
          </ul>
          <Button block onClick={() => setOpen(true)}>
            {t("backupSeePhrase")}
          </Button>
        </>
      )}
      {open && current && <BackupDialog wallet={current} onClose={() => setOpen(false)} />}
    </div>
  );
}
