import { useSession } from "./api/queries";
import { Button } from "./components/Button";
import { ConsentDialog } from "./components/ConsentDialog";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { SecurityBanner } from "./components/SecurityBanner";
import { t } from "./i18n";
import { BackupPage } from "./pages/backup/BackupPage";
import { HistoryPage } from "./pages/history/HistoryPage";
import { TxDetailPage } from "./pages/history/TxDetailPage";
import { HomePage } from "./pages/home/HomePage";
import { ReceivePage } from "./pages/home/ReceivePage";
import { TokenPage } from "./pages/tokens/TokenPage";
import { CreateWalletPage } from "./pages/wallets/CreateWalletPage";
import { ImportWalletPage } from "./pages/wallets/ImportWalletPage";
import { WalletsPage } from "./pages/wallets/WalletsPage";
import { href, useLocation, type Location } from "./router";

function ManagerStopped({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  return (
    <div className="screen">
      <h1 className="screen__title t-h1">{t("managerStoppedTitle")}</h1>
      <p className="screen__caption t-body-l">{t("managerStoppedText")}</p>
      <Button variant="secondary" disabled={busy} aria-busy={busy} onClick={onRetry}>
        {busy ? t("loading") : t("retry")}
      </Button>
    </div>
  );
}

function Screen({ location }: { location: Location }) {
  const { route, rest } = location;
  if (route === "home") {
    if (rest[0] === "receive") return <ReceivePage network={rest[1]} assetId={rest[2]} />;
    return <HomePage tokensOpen={false} />;
  }
  if (route === "tokens") {
    if (rest.length === 4 && rest[2] === "tx") {
      return <TxDetailPage network={rest[0]} id={rest[3]} backHref={href("tokens", rest[0], rest[1])} />;
    }
    if (rest.length === 2) return <TokenPage network={rest[0]} assetId={rest[1]} />;
    return <HomePage tokensOpen />;
  }
  if (route === "history") {
    if (rest.length === 3 && rest[1] === "tx") {
      return <TxDetailPage network={rest[0]} id={rest[2]} backHref={href("history", rest[0])} />;
    }
    return <HistoryPage network={rest[0]} />;
  }
  if (route === "wallets") {
    if (rest[0] === "new") return <CreateWalletPage />;
    if (rest[0] === "import") return <ImportWalletPage />;
    return <WalletsPage />;
  }
  return <BackupPage walletId={rest[0]} />;
}

/**
 * Screens that must not remount on a hash change: Home with the Tokens dialog
 * over it, and History across network chips (the chip row keeps its scroll).
 */
function screenKey({ route, rest }: Location): string {
  if (route === "tokens" && rest.length !== 2 && rest[2] !== "tx") return "home";
  if (route === "history" && rest.length <= 1) return "history";
  return [route, ...rest].join("/");
}

export function App() {
  const location = useLocation();
  const session = useSession();

  return (
    <div className="app">
      <Header active={location.route} />
      <SecurityBanner />
      <main className="content">
        {session.isError ? (
          <ManagerStopped busy={session.isFetching} onRetry={() => void session.refetch()} />
        ) : (
          session.data && <Screen key={screenKey(location)} location={location} />
        )}
      </main>
      <Footer />
      {session.data && !session.data.consent.accepted && <ConsentDialog consent={session.data.consent} />}
    </div>
  );
}
