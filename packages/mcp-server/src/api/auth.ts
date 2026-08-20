/**
 * Challenge-signature login, matching the mobile app:
 *   1. POST {authUrl}/api/v1/login/start  { wallets: [{ network, publicKey }] }
 *   2. Sign the returned challenge with the Ethereum key (EIP-191 personal_sign)
 *   3. POST {authUrl}/api/v1/login/confirm { challenge, signature }
 *      -> { accessToken, expiryIn }
 *
 * Tokens are cached per wallet (keyed by EVM address) until shortly before
 * expiry, then a fresh challenge login runs (the app does not use refresh).
 */

import { Wallet } from "ethers";
import { getConfig, commonHeaders, AUTH_NETWORKS } from "../config.js";
import { deriveAddresses, deriveEvm } from "../wallet/derive.js";
import { httpJson } from "./http.js";
import { logError, logInfo, newCorrelationId } from "../log.js";

interface StartResponse {
  challenge: string;
}
interface ConfirmResponse {
  accessToken: string;
  expiryIn: number;
}

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

const tokenCache = new Map<string, CachedToken>();

export interface AuthOpts {
  correlationId?: string;
}

/**
 * Return a valid Bearer token for the wallet identified by its mnemonic.
 * Uses the cache when the token is still fresh (10s safety margin).
 */
export async function getAccessToken(
  mnemonic: string,
  opts: AuthOpts = {},
): Promise<string> {
  const correlationId = opts.correlationId ?? newCorrelationId("auth");
  const cfg = getConfig();
  const addresses = deriveAddresses(mnemonic);
  const cacheKey = addresses.ethereum.toLowerCase();

  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    logInfo("auth.token.cache_hit", {
      correlationId,
      ethereum: addresses.ethereum,
      expiresInMs: cached.expiresAt - Date.now(),
    });
    return cached.token;
  }

  logInfo("auth.login.start", {
    correlationId,
    ethereum: addresses.ethereum,
    authUrl: cfg.authUrl,
    networks: AUTH_NETWORKS,
  });
  const started = Date.now();

  try {
    const wallets = AUTH_NETWORKS.map((network) => ({
      network,
      publicKey: addresses[network],
    }));

    const start = await httpJson<StartResponse>(
      `${cfg.authUrl}/api/v1/login/start`,
      {
        method: "POST",
        headers: { ...commonHeaders(cfg), "Content-Type": "application/json" },
        body: JSON.stringify({ wallets }),
      },
      { retry: true, correlationId, label: "auth.login.start" },
    );

    if (!start?.challenge) throw new Error("login/start returned no challenge.");
    logInfo("auth.login.challenge", {
      correlationId,
      challengeLen: start.challenge.length,
    });

    const evm = deriveEvm(mnemonic);
    const signature = await new Wallet(evm.privateKey).signMessage(start.challenge);

    const confirm = await httpJson<ConfirmResponse>(
      `${cfg.authUrl}/api/v1/login/confirm`,
      {
        method: "POST",
        headers: { ...commonHeaders(cfg), "Content-Type": "application/json" },
        body: JSON.stringify({ challenge: start.challenge, signature }),
      },
      { retry: true, correlationId, label: "auth.login.confirm" },
    );

    if (!confirm?.accessToken) throw new Error("login/confirm returned no token.");

    const expiresAt = Date.now() + Math.max(0, confirm.expiryIn - 10) * 1000;
    tokenCache.set(cacheKey, { token: confirm.accessToken, expiresAt });
    logInfo("auth.login.ok", {
      correlationId,
      ethereum: addresses.ethereum,
      elapsedMs: Date.now() - started,
      expiryIn: confirm.expiryIn,
      tokenLen: confirm.accessToken.length,
    });
    return confirm.accessToken;
  } catch (e) {
    logError("auth.login.fail", e, {
      correlationId,
      ethereum: addresses.ethereum,
      elapsedMs: Date.now() - started,
    });
    throw e;
  }
}

/** Authorization + device headers for authenticated backend calls. */
export function authHeaders(token: string): Record<string, string> {
  const cfg = getConfig();
  return { ...commonHeaders(cfg), Authorization: `Bearer ${token}` };
}
