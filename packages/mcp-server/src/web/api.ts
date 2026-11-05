/**
 * JSON API of the wallet manager, mounted under `/<token>/api`. The caller
 * (manager.ts) has already checked the capability token and the Host header;
 * write methods are additionally gated by `apiWriteRejection`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { getConfig, packageVersion } from "../config.js";
import { consentDocument } from "../consent/copy.js";
import { hasCurrentConsent, recordConsent } from "../consent/store.js";
import { logError, logInfo } from "../log.js";
import { walletHistory } from "./api-history.js";
import { setWalletTokenVisibility, walletPortfolio, walletTokens } from "./api-portfolio.js";
import { HttpError, readJson } from "./api-util.js";
import {
  createWallet,
  deleteWalletById,
  getPrefs,
  importWalletFromPhrase,
  listWallets,
  patchPrefs,
  renameWalletById,
  verifyWalletBackup,
  walletMnemonic,
} from "./api-wallets.js";
import type { ApiError, ConsentResponse, SessionResponse } from "./contract.js";
import { apiWriteRejection, sendJson } from "./security.js";

function session(): SessionResponse {
  const { version, title, lead, bullets, checkbox } = consentDocument();
  return {
    version: packageVersion(),
    readOnly: getConfig().readOnly,
    consent: { version, title, lead, bullets, checkbox, accepted: hasCurrentConsent() },
  };
}

async function acceptConsent(req: IncomingMessage): Promise<ConsentResponse> {
  const body = await readJson(req);
  if (body.understood !== true) {
    throw new HttpError(400, "bad_request", "Check the box to continue.");
  }
  recordConsent("manager");
  logInfo("manager.consent.ok", {});
  return { accepted: true };
}

async function route(
  req: IncomingMessage,
  method: string,
  sub: string,
  query: URLSearchParams,
): Promise<unknown> {
  if (sub === "/session" && method === "GET") return session();
  if (sub === "/consent" && method === "POST") return acceptConsent(req);

  if (sub === "/wallets") {
    if (method === "GET") return listWallets();
    if (method === "POST") return createWallet(req);
  }
  if (sub === "/wallets/import" && method === "POST") return importWalletFromPhrase(req);

  const wallet = /^\/wallets\/([0-9a-f]{16})$/.exec(sub);
  if (wallet) {
    if (method === "PATCH") return renameWalletById(req, wallet[1]);
    if (method === "DELETE") return deleteWalletById(req, wallet[1]);
  }
  const backup = /^\/wallets\/([0-9a-f]{16})\/(mnemonic|backup\/verify)$/.exec(sub);
  if (backup && method === "POST") {
    return backup[2] === "mnemonic" ? walletMnemonic(backup[1]) : verifyWalletBackup(req, backup[1]);
  }
  const holdings = /^\/wallets\/([0-9a-f]{16})\/(portfolio|tokens|history)$/.exec(sub);
  if (holdings && method === "GET") {
    if (holdings[2] === "history") return walletHistory(holdings[1], query);
    return holdings[2] === "portfolio" ? walletPortfolio(holdings[1], query) : walletTokens(holdings[1], query);
  }
  const token = /^\/wallets\/([0-9a-f]{16})\/tokens\/([a-z]+)\/([A-Za-z0-9_-]{1,64})$/.exec(sub);
  if (token && method === "PUT") return setWalletTokenVisibility(req, token[1], token[2], token[3]);

  if (sub === "/prefs") {
    if (method === "GET") return getPrefs();
    if (method === "PATCH") return patchPrefs(req);
  }
  throw new HttpError(404, "not_found", "Unknown API route.");
}

/** Handle `/api/...`; `sub` is the path below `/api`. */
export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  sub: string,
  port: number,
  query = new URLSearchParams(),
): Promise<void> {
  const method = req.method ?? "GET";
  try {
    if (method !== "GET" && method !== "HEAD") {
      const rejection = apiWriteRejection(req, port);
      if (rejection) throw new HttpError(403, "forbidden", rejection);
    }
    sendJson(res, 200, await route(req, method, sub, query));
  } catch (e) {
    const err =
      e instanceof HttpError
        ? e
        : new HttpError(500, "internal", e instanceof Error ? e.message : String(e));
    if (err.status >= 500) logError("manager.api.fail", e, { method, path: sub });
    const body: ApiError = { error: { code: err.code, message: err.message } };
    sendJson(res, err.status, body);
  }
}
