import { useEffect, useRef } from "react";
import type { WalletSummary } from "../../../../src/web/contract";
import { ChipRow } from "../../components/ChipRow";
import { ScreenHeader } from "../../components/ScreenHeader";
import { t } from "../../i18n";
import { networkName, walletNetworks } from "../../networks";
import { href, navigate } from "../../router";
import { WalletGate } from "../home/WalletGate";
import { WalletPicker } from "../home/WalletPicker";
import { HistoryFeed } from "./HistoryFeed";

/** `#/history/<network>`: one network of the selected wallet, 20 rows per page. */
export function HistoryPage({ network }: { network?: string }) {
  return (
    <WalletGate>
      {(wallet, wallets) => <History key={wallet.id} wallet={wallet} wallets={wallets} network={network} />}
    </WalletGate>
  );
}

interface HistoryProps {
  wallet: WalletSummary;
  wallets: WalletSummary[];
  network?: string;
}

function History({ wallet, wallets, network }: HistoryProps) {
  const networks = walletNetworks(wallet.addresses);
  const current = network && networks.includes(network) ? network : networks[0];
  const selectedChip = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedChip.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, []);

  return (
    <div className="page history">
      <ScreenHeader title={t("historyTitle")} />
      <div className="history__wallet">
        <WalletPicker wallets={wallets} current={wallet} />
      </div>
      <ChipRow className="history__chips" label={t("networkTitle")}>
        {networks.map((n) => (
          <button
            key={n}
            ref={n === current ? selectedChip : undefined}
            type="button"
            className={n === current ? "chip chip--selected" : "chip"}
            aria-pressed={n === current}
            onClick={() => navigate("history", n)}
          >
            {networkName(n)}
          </button>
        ))}
      </ChipRow>
      {current && (
        <HistoryFeed
          key={current}
          walletId={wallet.id}
          network={current}
          hrefFor={(item) => href("history", current, "tx", item.id)}
          emptyText={t("historyEmpty")}
        />
      )}
      <p className="footer-note t-paragraph-s">{t("footerNote")}</p>
    </div>
  );
}
