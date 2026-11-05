import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  ConsentRequest,
  ConsentResponse,
  CreateWalletRequest,
  DeleteWalletRequest,
  DeleteWalletResponse,
  HistoryResponse,
  ImportWalletRequest,
  PortfolioResponse,
  PrefsRequest,
  PrefsResponse,
  RenameWalletRequest,
  SessionResponse,
  TokensResponse,
  TokenVisibilityRequest,
  TokenVisibilityResponse,
  WalletResponse,
  WalletsResponse,
} from "../../../src/web/contract";
import { api } from "./client";

export const queryKeys = {
  session: ["session"] as const,
  wallets: ["wallets"] as const,
  prefs: ["prefs"] as const,
  portfolio: (walletId: string) => ["portfolio", walletId] as const,
  tokens: (walletId: string) => ["tokens", walletId] as const,
  history: (walletId: string, network?: string) =>
    network ? (["history", walletId, network] as const) : (["history", walletId] as const),
};

/** The server caches balances for 30s; refetching sooner only returns the same numbers. */
const PORTFOLIO_STALE_MS = 30_000;
/** Explorers lag the chain by about a minute and rate-limit keyless callers. */
const HISTORY_STALE_MS = 60_000;

export function useSession() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: () => api.get<SessionResponse>("session"),
    staleTime: Infinity,
  });
}

export function useAcceptConsent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ConsentResponse>("consent", { understood: true } satisfies ConsentRequest),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.session }),
  });
}

export function useWallets() {
  return useQuery({
    queryKey: queryKeys.wallets,
    queryFn: () => api.get<WalletsResponse>("wallets"),
  });
}

/** Every wallet mutation refreshes the list (and with it the selection). */
function useWalletMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.wallets }),
  });
}

export function useCreateWallet() {
  return useWalletMutation((body: CreateWalletRequest) => api.post<WalletResponse>("wallets", body));
}

export function useImportWallet() {
  return useWalletMutation((body: ImportWalletRequest) => api.post<WalletResponse>("wallets/import", body));
}

export function useRenameWallet() {
  return useWalletMutation(({ id, ...body }: RenameWalletRequest & { id: string }) =>
    api.patch<WalletResponse>(`wallets/${id}`, body),
  );
}

export function useDeleteWallet() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<DeleteWalletResponse>(`wallets/${id}`, { acknowledged: true } satisfies DeleteWalletRequest),
    onSuccess: (_, id) => {
      client.removeQueries({ queryKey: queryKeys.portfolio(id) });
      client.removeQueries({ queryKey: queryKeys.tokens(id) });
      client.removeQueries({ queryKey: queryKeys.history(id) });
      return client.invalidateQueries({ queryKey: queryKeys.wallets });
    },
  });
}

export function useSelectWallet() {
  return useWalletMutation((id: string) =>
    api.patch<PrefsResponse>("prefs", { selectedWalletId: id } satisfies PrefsRequest),
  );
}

export function usePrefs() {
  return useQuery({
    queryKey: queryKeys.prefs,
    queryFn: () => api.get<PrefsResponse>("prefs"),
    staleTime: Infinity,
  });
}

export function useUpdatePrefs() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: PrefsRequest) => api.patch<PrefsResponse>("prefs", body),
    onSuccess: (prefs) => client.setQueryData(queryKeys.prefs, prefs),
  });
}

/** The server answers slow networks as `pending` and keeps reading them; ask again until none are left. */
const PENDING_POLL_MS = 1000;

const pollWhilePending = (query: { state: { data?: { pending: string[]; ratesPending: boolean } } }) =>
  query.state.data?.pending.length || query.state.data?.ratesPending ? PENDING_POLL_MS : false;

const portfolioQuery = (walletId: string) => ({
  queryKey: queryKeys.portfolio(walletId),
  queryFn: () => api.get<PortfolioResponse>(`wallets/${walletId}/portfolio`),
  staleTime: PORTFOLIO_STALE_MS,
  refetchInterval: pollWhilePending,
});

export function usePortfolio(walletId: string | null | undefined) {
  return useQuery({ ...portfolioQuery(walletId ?? ""), enabled: !!walletId });
}

/** One portfolio per wallet (Wallets page totals); shares the cache with usePortfolio. */
export function usePortfolios(walletIds: string[]) {
  return useQueries({ queries: walletIds.map(portfolioQuery) });
}

/**
 * Refresh Balances: one `?refresh=1` read past the server cache. Its answer
 * replaces the portfolio, and networks still reading poll like a first load.
 */
export function useRefreshPortfolio(walletId: string) {
  const client = useQueryClient();
  const queryKey = queryKeys.portfolio(walletId);
  return useMutation({
    mutationFn: async () => {
      await client.cancelQueries({ queryKey });
      return api.get<PortfolioResponse>(`wallets/${walletId}/portfolio?refresh=1`);
    },
    onSuccess: (portfolio) => {
      client.setQueryData(queryKey, portfolio);
      return client.invalidateQueries({ queryKey: queryKeys.tokens(walletId) });
    },
  });
}

export function useTokenList(walletId: string, networks: string[], q: string) {
  const params = new URLSearchParams();
  if (networks.length > 0) params.set("network", networks.join(","));
  if (q) params.set("q", q);
  return useQuery({
    queryKey: [...queryKeys.tokens(walletId), networks.join(","), q],
    queryFn: () => api.get<TokensResponse>(`wallets/${walletId}/tokens?${params}`),
    staleTime: PORTFOLIO_STALE_MS,
    refetchInterval: pollWhilePending,
    placeholderData: keepPreviousData,
  });
}

/** Thrown for an older page the explorers could not serve, so Load more can retry just that page. */
export class HistoryUnavailableError extends Error {}

/**
 * Pages of one network's history. The first page reports `unavailable` in its
 * data; a later page throws instead so the pages already shown stay.
 */
export function useHistory(walletId: string, network: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.history(walletId, network),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ network });
      if (pageParam) params.set("cursor", pageParam);
      const page = await api.get<HistoryResponse>(`wallets/${walletId}/history?${params}`);
      if (pageParam && page.status !== "ok") throw new HistoryUnavailableError(page.status);
      return page;
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: HISTORY_STALE_MS,
    enabled: !!network,
  });
}

export function useSetTokenVisibility(walletId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ network, assetId, visible }: { network: string; assetId: string; visible: boolean }) =>
      api.put<TokenVisibilityResponse>(
        `wallets/${walletId}/tokens/${network}/${encodeURIComponent(assetId)}`,
        { visible } satisfies TokenVisibilityRequest,
      ),
    onSuccess: ({ key, visible }) => {
      client.setQueriesData<TokensResponse>({ queryKey: queryKeys.tokens(walletId) }, (list) =>
        list && { ...list, tokens: list.tokens.map((t) => (t.key === key ? { ...t, visible } : t)) },
      );
      void client.invalidateQueries({ queryKey: queryKeys.portfolio(walletId) });
    },
  });
}
