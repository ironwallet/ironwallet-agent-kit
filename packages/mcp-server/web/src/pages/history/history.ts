import type { HistoryItemView, HistoryResponse } from "../../../../src/web/contract";
import receiveIcon from "../../assets/icon-tx-receive.svg";
import sendIcon from "../../assets/icon-tx-send.svg";
import swapIcon from "../../assets/icon-tx-swap.svg";
import { t, type MessageKey } from "../../i18n";
import { formatAmount } from "../../money";
import { networkName } from "../../networks";
import { shortAddress } from "../wallets/format";

/** Rows of every loaded page; a row repeated across a page boundary shows once. */
export function historyItems(pages: HistoryResponse[] | undefined): HistoryItemView[] {
  const seen = new Set<string>();
  const out: HistoryItemView[] = [];
  for (const it of (pages ?? []).flatMap((p) => p.items)) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

/** en-GB abbreviates September as "Sept"; the design uses three letters. */
const monthShort = new Intl.DateTimeFormat("en-US", { month: "short" });
const detailDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });
const detailTime = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** "Today", "Yesterday" or "15 Sep 2026" in local time; pending rows count as today. */
function dayLabel(timestamp: string | null, now: Date): string {
  const date = timestamp ? new Date(timestamp) : now;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(date) === dayKey(now)) return t("today");
  if (dayKey(date) === dayKey(yesterday)) return t("yesterday");
  return `${date.getDate()} ${monthShort.format(date)} ${date.getFullYear()}`;
}

export interface DayGroup {
  label: string;
  items: HistoryItemView[];
}

/** Consecutive rows of one local day, newest first (the server's order). */
export function groupByDay(items: HistoryItemView[], now = new Date()): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const it of items) {
    const label = dayLabel(it.timestamp, now);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(it);
    else groups.push({ label, items: [it] });
  }
  return groups;
}

/** "17 September 2026 / 08:45:26". */
export function formatTxDate(timestamp: string): string {
  const date = new Date(timestamp);
  return `${detailDate.format(date)} / ${detailTime.format(date)}`;
}

/** Title and grey suffix: "ETH (Ethereum)" for coins, "Tether USD (TRC20)" for catalog tokens. */
export function assetTitle(it: HistoryItemView, network: string): { main: string; suffix: string } {
  const { standard, name, symbol } = it.asset;
  return standard ? { main: name ?? symbol, suffix: standard } : { main: symbol, suffix: networkName(network) };
}

/** Transfers are often smaller than a balance, so rows keep at least 6 decimals: "+0.025488 ETH". */
const TX_MIN_DECIMALS = 6;

export function signedAmount(it: HistoryItemView): string {
  const sign = it.direction === "in" ? "+" : it.direction === "out" ? "-" : "";
  const amount = formatAmount(it.amount, Math.max(it.asset.displayDecimals, TX_MIN_DECIMALS));
  return `${sign}${amount} ${it.asset.symbol}`;
}

export const DIRECTION_ICON: Record<HistoryItemView["direction"], { src: string; color: string }> = {
  in: { src: receiveIcon, color: "var(--status-success)" },
  out: { src: sendIcon, color: "var(--status-info)" },
  self: { src: swapIcon, color: "var(--status-warning)" },
};

export const STATUS: Record<HistoryItemView["status"], { label: MessageKey; className: string }> = {
  confirmed: { label: "txConfirmed", className: "tx-status--confirmed" },
  pending: { label: "txPending", className: "tx-status--pending" },
  failed: { label: "txFailed", className: "tx-status--failed" },
};

/** The other side of the transfer: a wallet name on this machine, else a short address. */
export function counterparty(it: HistoryItemView): string {
  if (it.counterpartyWallet) return it.counterpartyWallet;
  const address = it.direction === "in" ? it.from : it.direction === "out" ? it.to : null;
  return address ? shortAddress(address) : "";
}

export function detailTitle(it: HistoryItemView): MessageKey {
  return it.direction === "in" ? "txReceived" : it.direction === "out" ? "txSent" : "txSelf";
}
