/**
 * Relay (forward) API client, mirroring the mobile RelayApiV2Client:
 *   GET  {relayUrl}{ver}/{Network}/forward/estimate?fromAddress&toAddress&...
 *   POST {relayUrl}{ver}/{Network}/forward
 *   GET  {relayUrl}{ver}/{Network}/forward/operation/{id}/state
 *
 * `ver` defaults to `/v1` (gasless v1). Set IW_RELAY_VERSION= (empty) or
 * IW_RELAY_VERSION=v0 to fall back to the legacy path without a version segment.
 */

import { getConfig, relaySegment, type NetworkId } from "../config.js";
import { authHeaders } from "./auth.js";
import { httpJson } from "./http.js";
import type { SignedTransaction, TransactionToSign } from "../signing/types.js";
import { logError, logInfo, newCorrelationId } from "../log.js";

export interface EstimateResult {
  amount?: string;
  coinFee?: string;
  tokenFee?: string;
  transactionsToSign: TransactionToSign[];
  additionalEstimates?: unknown[];
  timeout?: number;
}

export interface SignedEstimate {
  signature?: string;
  estimateResult?: EstimateResult;
  traceId?: string;
}

export interface ForwardResult {
  txHash?: string;
  operationId?: string;
  chainId?: string;
  [k: string]: unknown;
}

function versionSegment(): string {
  // Default to v1 (matches the mobile gaslessV1 path). Explicit empty / "v0"
  // selects the legacy unversioned URL.
  const raw = process.env.IW_RELAY_VERSION;
  const v = (raw === undefined ? "v1" : raw).trim();
  if (!v || v === "v0") return "";
  return v.startsWith("/") ? v : `/${v}`;
}

function baseUrl(network: NetworkId): string {
  const cfg = getConfig();
  return `${cfg.relayUrl}${versionSegment()}/${relaySegment(network)}`;
}

export interface EstimateParams {
  fromAddress: string;
  toAddress: string;
  tokenAddress?: string;
  amount: string;
  memo?: string;
  /** Required for TON (mobile IR-673): 32-byte ed25519 pubkey hex. */
  fromPublicKey?: string;
}

export interface RelayCallOpts {
  correlationId?: string;
}

export async function estimate(
  network: NetworkId,
  token: string,
  params: EstimateParams,
  callOpts: RelayCallOpts = {},
): Promise<SignedEstimate> {
  const correlationId = callOpts.correlationId ?? newCorrelationId("est");
  const query = new URLSearchParams();
  query.set("fromAddress", params.fromAddress);
  query.set("toAddress", params.toAddress);
  if (params.tokenAddress) query.set("tokenAddress", params.tokenAddress);
  query.set("amount", params.amount);
  if (params.memo) query.set("memo", params.memo);
  if (params.fromPublicKey) query.set("fromPublicKey", params.fromPublicKey);

  const url = `${baseUrl(network)}/forward/estimate?${query.toString()}`;
  logInfo("relay.estimate.start", {
    correlationId,
    network,
    fromAddress: params.fromAddress,
    toAddress: params.toAddress,
    amount: params.amount,
    tokenAddress: params.tokenAddress,
    hasMemo: Boolean(params.memo),
    hasFromPublicKey: Boolean(params.fromPublicKey),
    url,
  });
  const started = Date.now();
  try {
    const result = await httpJson<SignedEstimate>(
      url,
      {
        method: "GET",
        headers: authHeaders(token),
      },
      { correlationId, label: "relay.estimate" },
    );
    const er = result.estimateResult;
    logInfo("relay.estimate.ok", {
      correlationId,
      network,
      elapsedMs: Date.now() - started,
      traceId: result.traceId,
      amount: er?.amount,
      coinFee: er?.coinFee,
      tokenFee: er?.tokenFee,
      transactionsToSign: er?.transactionsToSign?.length ?? 0,
      timeout: er?.timeout,
      hasSignature: typeof result.signature === "string",
    });
    return result;
  } catch (e) {
    logError("relay.estimate.fail", e, {
      correlationId,
      network,
      elapsedMs: Date.now() - started,
    });
    throw e;
  }
}

export async function forward(
  network: NetworkId,
  token: string,
  params: EstimateParams,
  signedEstimateResult: SignedEstimate,
  signedTransactions: SignedTransaction[],
  callOpts: RelayCallOpts = {},
): Promise<ForwardResult> {
  const correlationId = callOpts.correlationId ?? newCorrelationId("fwd");
  const body: Record<string, unknown> = {
    fromAddress: params.fromAddress,
    toAddress: params.toAddress,
    amount: params.amount,
    signedEstimateResult,
    signedTransactions,
  };
  if (params.tokenAddress) body.tokenAddress = params.tokenAddress;

  const cfg = getConfig();
  const url = `${baseUrl(network)}/forward`;
  logInfo("relay.forward.start", {
    correlationId,
    network,
    fromAddress: params.fromAddress,
    toAddress: params.toAddress,
    amount: params.amount,
    tokenAddress: params.tokenAddress,
    url,
    timeoutMs: cfg.httpForwardTimeoutMs,
    retries: false,
    signedTxCount: signedTransactions.length,
    signedTxs: signedTransactions.map((t, i) => ({
      i,
      transactionId: t.transactionId,
      txID: t.txID,
      signatureLen: t.signature?.length,
      txDataLen: t.txData?.length,
    })),
    estimateTraceId: signedEstimateResult.traceId,
    estimateAmount: signedEstimateResult.estimateResult?.amount,
    estimateCoinFee: signedEstimateResult.estimateResult?.coinFee,
    estimateTokenFee: signedEstimateResult.estimateResult?.tokenFee,
  });
  const started = Date.now();
  try {
    const result = await httpJson<ForwardResult>(
      url,
      {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      // Never retry a broadcast. Use the longer forward timeout — the relay may
      // still submit the tx even if the client would otherwise give up at 15s.
      {
        retry: false,
        timeoutMs: cfg.httpForwardTimeoutMs,
        correlationId,
        label: "relay.forward",
      },
    );
    logInfo("relay.forward.ok", {
      correlationId,
      network,
      elapsedMs: Date.now() - started,
      txHash: result.txHash,
      operationId: result.operationId,
      chainId: result.chainId,
      resultKeys: Object.keys(result),
    });
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const timedOut = /timed out/i.test(msg);
    logError("relay.forward.fail", e, {
      correlationId,
      network,
      elapsedMs: Date.now() - started,
      timedOut,
      timeoutMs: cfg.httpForwardTimeoutMs,
      warning:
        "Relay may still have broadcast the transaction. Check sender/receiver balances and explorer before retrying — do not resend blindly.",
    });
    if (timedOut) {
      throw new Error(
        `${msg}. The relay may still have broadcast the transaction — ` +
          `check the wallet balance / explorer before retrying (do not resend blindly). ` +
          `[correlationId=${correlationId}]`,
      );
    }
    throw new Error(
      `${msg} [correlationId=${correlationId}]` +
        ( /fetch failed|Network error/i.test(msg)
          ? ". Connection may have dropped after the relay accepted the request — check balances before retrying."
          : ""),
    );
  }
}

export async function operationState(
  network: NetworkId,
  token: string,
  operationId: string,
  callOpts: RelayCallOpts = {},
): Promise<{ state?: string; reasonCode?: string; [k: string]: unknown }> {
  const correlationId = callOpts.correlationId ?? newCorrelationId("ops");
  const url = `${baseUrl(network)}/forward/operation/${operationId}/state`;
  logInfo("relay.operation_state.start", {
    correlationId,
    network,
    operationId,
    url,
  });
  try {
    const result = await httpJson<{ state?: string; reasonCode?: string; [k: string]: unknown }>(
      url,
      { method: "GET", headers: authHeaders(token) },
      { correlationId, label: "relay.operation_state" },
    );
    logInfo("relay.operation_state.ok", {
      correlationId,
      network,
      operationId,
      state: result.state,
      reasonCode: result.reasonCode,
    });
    return result;
  } catch (e) {
    logError("relay.operation_state.fail", e, {
      correlationId,
      network,
      operationId,
    });
    throw e;
  }
}
