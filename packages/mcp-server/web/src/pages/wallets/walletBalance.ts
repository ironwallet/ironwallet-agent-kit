import type { UseQueryResult } from "@tanstack/react-query";
import type { PortfolioResponse } from "../../../../src/web/contract";
import { formatUsd } from "../../money";

/** Row label for a wallet's USD total: "…" until the first answer, blank if it failed. */
export function balanceLabel(portfolio: UseQueryResult<PortfolioResponse> | undefined): string {
  if (!portfolio || portfolio.isPending) return "…";
  return portfolio.data ? formatUsd(portfolio.data.totalUsd) : "";
}
