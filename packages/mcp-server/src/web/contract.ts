/**
 * Wire types of the wallet manager JSON API (`/<token>/api/*`). Types only:
 * the browser bundle imports this file with `import type`, so nothing here may
 * carry runtime code or server-only imports.
 */

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

export type ApiErrorCode =
  | "bad_request"
  | "forbidden"
  | "not_found"
  | "consent_required"
  | "backup_mismatch"
  | "internal";

export interface ConsentText {
  version: string;
  title: string;
  lead: string;
  bullets: readonly string[];
  checkbox: string;
}

export interface SessionResponse {
  version: string;
  /** `IW_READ_ONLY`: the agent cannot send or swap from any wallet. */
  readOnly: boolean;
  consent: ConsentText & { accepted: boolean };
}

export interface ConsentRequest {
  understood: true;
}

export interface ConsentResponse {
  accepted: true;
}

export interface WalletSummary {
  /** Stable handle for URLs and prefs; the name can change. */
  id: string;
  name: string;
  backedUp: boolean;
  createdAt: string;
  /** Public receive addresses by network id. */
  addresses: Record<string, string>;
}

export interface WalletsResponse {
  wallets: WalletSummary[];
  /** The wallet Home / Tokens / History show; null only when there are no wallets. */
  selectedId: string | null;
}

export interface CreateWalletRequest {
  name: string;
}

export interface ImportWalletRequest {
  name: string;
  mnemonic: string;
}

export interface RenameWalletRequest {
  name: string;
}

export interface DeleteWalletRequest {
  /** The user ticked "I have my seed phrase saved" in the confirmation dialog. */
  acknowledged: true;
}

export interface WalletResponse {
  wallet: WalletSummary;
}

export interface DeleteWalletResponse {
  deleted: true;
}

/** `POST /wallets/:id/mnemonic`: shown in the browser only; does not mark the wallet backed up. */
export interface MnemonicResponse {
  words: string[];
}

/** `POST /wallets/:id/backup/verify`: the words in the order the user put them. */
export interface VerifyBackupRequest {
  words: string[];
}

export type TokenSort = "name" | "amount" | "value";

export type Theme = "light" | "dark";

export interface PrefsRequest {
  selectedWalletId?: string;
  tokenSort?: TokenSort;
  showZeroBalances?: boolean;
  theme?: Theme;
}

export interface PrefsResponse {
  selectedWalletId: string | null;
  tokenSort: TokenSort;
  showZeroBalances: boolean;
  /** null: the user never picked one, the OS colour scheme applies. */
  theme: Theme | null;
}

/** One asset of a wallet with its balance and USD valuation. */
export interface TokenView {
  /** `network:assetId`; stable across catalog refreshes. */
  key: string;
  network: string;
  assetId: string;
  symbol: string;
  name: string;
  /** Token standard shown next to the name (ERC20, BEP20, TRC20…); null for native coins. */
  standard: string | null;
  /** Contract / mint / jetton master; null for the native coin. */
  address: string | null;
  decimals: number;
  displayDecimals: number;
  /** Decimal string in whole units; null when the network did not answer. */
  balance: string | null;
  usdPrice: number | null;
  /** 24h price change in percent. */
  change24h: number | null;
  usdValue: number | null;
  /** Relative URL of the icon (`icons/<network>/<assetId>`), null when the catalog has none. */
  icon: string | null;
}

export interface NetworkError {
  network: string;
  message: string;
}

/**
 * `GET /wallets/:id/portfolio[?refresh=1]`: the tokens the manager shows for
 * this wallet. `refresh=1` bypasses the short balance cache.
 */
export interface PortfolioResponse {
  walletId: string;
  tokens: TokenView[];
  /** Sum of known USD values; networks in `errors` and `pending` are not included. */
  totalUsd: number;
  errors: NetworkError[];
  /** Networks whose catalog or balances are still loading. Not an error: ask again shortly. */
  pending: string[];
  /** USD rates are still loading; prices shown are the last known ones, if any. */
  ratesPending: boolean;
}

/** `GET /wallets/:id/tokens?network=&q=`: catalog entries for the Tokens list. */
export interface TokensResponse {
  tokens: Array<TokenView & { visible: boolean }>;
  /** Matches before the limit was applied. */
  total: number;
  errors: NetworkError[];
  /** Networks whose catalog or balances are still loading. Not an error: ask again shortly. */
  pending: string[];
  /** USD rates are still loading; prices shown are the last known ones, if any. */
  ratesPending: boolean;
}

/** `PUT /wallets/:id/tokens/:network/:assetId`. Display only: the agent still sees every token. */
export interface TokenVisibilityRequest {
  visible: boolean;
}

export interface TokenVisibilityResponse {
  key: string;
  visible: boolean;
}

/** One history row. Symbols and addresses come from third-party indexers: render them as text only. */
export interface HistoryItemView {
  /** Stable within a network: hash plus asset and direction (one hash can move several assets). */
  id: string;
  hash: string;
  /** ISO 8601; null while pending. */
  timestamp: string | null;
  kind: "transfer" | "token_transfer" | "contract_call" | "other";
  direction: "in" | "out" | "self";
  status: "confirmed" | "failed" | "pending";
  from: string | null;
  to: string | null;
  asset: {
    symbol: string;
    /** Catalog entry for this asset, when the catalog has one. */
    assetId: string | null;
    name: string | null;
    standard: string | null;
    icon: string | null;
    displayDecimals: number;
    /** Set when the symbol looks like an unsolicited token. */
    warning?: string;
  };
  /** Whole units, unsigned. */
  amount: string;
  /** What this wallet paid; null when the counterparty paid or it is unknown. */
  fee: { amount: string; symbol: string } | null;
  /** Name of another wallet on this machine when it is the counterparty. */
  counterpartyWallet: string | null;
  explorerUrl: string;
}

/**
 * `GET /wallets/:id/history?network=&cursor=`: one page (up to 20) newest first.
 * `unavailable` means the explorers did not answer, not an empty history.
 */
export interface HistoryResponse {
  network: string;
  address: string;
  status: "ok" | "unavailable" | "unsupported";
  items: HistoryItemView[];
  nextCursor: string | null;
}
