import { useCallback, useState } from "react";
import type { WalletSummary } from "../../../../src/web/contract";
import { errorMessage } from "../../api/client";
import { usePortfolios, useSelectWallet, useWallets } from "../../api/queries";
import { Button } from "../../components/Button";
import { ScreenHeader } from "../../components/ScreenHeader";
import { Toast } from "../../components/Toast";
import { t } from "../../i18n";
import { formatUsd } from "../../money";
import { href, navigate } from "../../router";
import { BackupDialog } from "../backup/BackupDialog";
import { RevealPhraseDialog } from "../backup/RevealPhraseDialog";
import { DeleteWalletDialog } from "./DeleteWalletDialog";
import { RenameDialog } from "./RenameDialog";
import { WalletActionsDialog, type WalletAction } from "./WalletActionsDialog";
import { WalletRow } from "./WalletRow";
import { balanceLabel } from "./walletBalance";

type Dialog = { kind: "actions" | WalletAction; wallet: WalletSummary } | null;

export function WalletsPage() {
  const wallets = useWallets();
  const select = useSelectWallet();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<string | null>(null);
  const closeDialog = useCallback(() => setDialog(null), []);
  const closeToast = useCallback(() => setToast(null), []);
  const list = wallets.data?.wallets ?? [];
  const portfolios = usePortfolios(list.map((w) => w.id));
  const loaded = portfolios.every((p) => p.data);
  const total = portfolios.reduce((sum, p) => sum + (p.data?.totalUsd ?? 0), 0);

  return (
    <div className="page">
      <ScreenHeader title={t("walletsTitle")} backHref={href("home")} />
      {list.length > 0 && (
        <div className="total-balance">
          <p className="total-balance__caption t-body-l">{t("totalBalance")}</p>
          <p className="t-display-m">{loaded ? formatUsd(total) : "…"}</p>
        </div>
      )}
      <div className="button-row">
        <Button variant="secondary" size="m" onClick={() => navigate("wallets", "import")}>
          {t("walletsImport")}
        </Button>
        <Button size="m" onClick={() => navigate("wallets", "new")}>
          {t("walletsCreate")}
        </Button>
      </div>
      <p className="page__note t-caption">{t("walletsNote")}</p>

      {wallets.isPending && <p className="page__status t-paragraph-m">{t("loading")}</p>}
      {wallets.isError && (
        <p className="form-error t-paragraph-s">
          {t("walletsLoadFailed")} {errorMessage(wallets.error)}
        </p>
      )}
      {wallets.data && wallets.data.wallets.length === 0 && (
        <p className="page__status t-paragraph-m">{t("walletsEmpty")}</p>
      )}
      {wallets.data && wallets.data.wallets.length > 0 && (
        <ul className="wallet-list">
          {wallets.data.wallets.map((w, i) => (
            <WalletRow
              key={w.id}
              wallet={w}
              balance={balanceLabel(portfolios[i])}
              selected={w.id === wallets.data.selectedId}
              onSelect={() => w.id !== wallets.data.selectedId && select.mutate(w.id)}
              onMore={() => setDialog({ kind: "actions", wallet: w })}
            />
          ))}
        </ul>
      )}
      {toast && <Toast message={toast} onClose={closeToast} />}

      {dialog?.kind === "actions" && (
        <WalletActionsDialog
          wallet={dialog.wallet}
          onAction={(kind) => setDialog({ kind, wallet: dialog.wallet })}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === "rename" && <RenameDialog wallet={dialog.wallet} onClose={closeDialog} />}
      {dialog?.kind === "backup" && <BackupDialog wallet={dialog.wallet} onClose={closeDialog} />}
      {dialog?.kind === "reveal" && <RevealPhraseDialog wallet={dialog.wallet} onClose={closeDialog} />}
      {dialog?.kind === "delete" && (
        <DeleteWalletDialog
          wallet={dialog.wallet}
          onClose={closeDialog}
          onBackup={() => setDialog({ kind: "backup", wallet: dialog.wallet })}
          onDeleted={() => {
            setToast(t("walletDeleted", { name: dialog.wallet.name }));
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}
