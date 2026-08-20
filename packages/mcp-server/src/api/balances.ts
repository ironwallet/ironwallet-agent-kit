/**
 * On-chain balances read directly from RPC.
 *   - EVM: ethers JsonRpcProvider. Native via getBalance; ERC-20 via
 *     balanceOf/decimals/symbol calls.
 *   - Tron: TronGrid HTTP API. Native TRX via /wallet/getaccount; TRC-20 via
 *     /wallet/triggerconstantcontract (balanceOf) plus on-chain decimals/symbol.
 *   - Solana: native SOL via getBalance; SPL via getTokenAccountsByOwner + mint.
 *   - TON: native via getAddressBalance; jettons via TonCenter v3 indexer,
 *     with on-chain get_wallet_address + get_wallet_data as fallback.
 */

import { Contract, formatUnits, getAddress } from "ethers";
import { Address, beginCell, Cell, Dictionary, TonClient } from "@ton/ton";
import { sha256 } from "@noble/hashes/sha2.js";
import { getConfig, isEvmNetwork, type NetworkId } from "../config.js";
import { httpJson } from "./http.js";
import { providerFor } from "./rpc.js";
import { logError, logInfo } from "../log.js";

export interface BalanceResult {
  network: NetworkId;
  address: string;
  /** Token contract address for non-native balances; null for the native coin. */
  contractAddress: string | null;
  symbol: string;
  decimals: number;
  /** Balance in the smallest unit (wei / sun / token base units) as a string. */
  raw: string;
  /** Human-readable balance formatted with `decimals`. */
  formatted: string;
}

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const NATIVE_SYMBOL: Record<NetworkId, string> = {
  ethereum: "ETH",
  bsc: "BNB",
  polygon: "POL",
  base: "ETH",
  arbitrum: "ETH",
  optimism: "ETH",
  avalanche: "AVAX",
  tron: "TRX",
  bitcoin: "BTC",
  litecoin: "LTC",
  doge: "DOGE",
  solana: "SOL",
  ton: "TON",
  xrp: "XRP",
};

async function getEvmBalance(
  network: NetworkId,
  address: string,
  contractAddress?: string,
): Promise<BalanceResult> {
  const provider = providerFor(network);
  const owner = getAddress(address);

  if (!contractAddress) {
    const raw = await provider.getBalance(owner);
    return {
      network,
      address: owner,
      contractAddress: null,
      symbol: NATIVE_SYMBOL[network],
      decimals: 18,
      raw: raw.toString(),
      formatted: formatUnits(raw, 18),
    };
  }

  const token = getAddress(contractAddress);
  const erc20 = new Contract(token, ERC20_ABI, provider);
  const [raw, decimals, symbol] = await Promise.all([
    erc20.balanceOf(owner) as Promise<bigint>,
    erc20.decimals().then((d: bigint) => Number(d)).catch(() => 18),
    erc20.symbol().catch(() => "TOKEN") as Promise<string>,
  ]);
  return {
    network,
    address: owner,
    contractAddress: token,
    symbol,
    decimals,
    raw: raw.toString(),
    formatted: formatUnits(raw, decimals),
  };
}

interface TronAccount {
  balance?: number;
}

interface TronTriggerResult {
  constant_result?: string[];
}

/** Decode a hex ABI-encoded uint256 word. */
function hexWordToBigInt(hex?: string): bigint {
  if (!hex) return 0n;
  return BigInt(`0x${hex.replace(/^0x/, "") || "0"}`);
}

/** Decode an ABI-encoded string return value (offset + length + bytes). */
function decodeAbiString(hex?: string): string | undefined {
  if (!hex) return undefined;
  const clean = hex.replace(/^0x/, "");
  if (clean.length < 128) return undefined;
  const length = Number(BigInt(`0x${clean.slice(64, 128)}`));
  const bytes = clean.slice(128, 128 + length * 2);
  const buf = Buffer.from(bytes, "hex");
  const s = buf.toString("utf8").replace(/\0+$/, "");
  return s.length > 0 ? s : undefined;
}

async function tronCall(
  ownerAddress: string,
  contractAddress: string,
  selector: string,
  parameter: string,
): Promise<string | undefined> {
  const cfg = getConfig();
  const res = await httpJson<TronTriggerResult>(
    `${cfg.tronApiUrl}/wallet/triggerconstantcontract`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner_address: ownerAddress,
        contract_address: contractAddress,
        function_selector: selector,
        parameter,
        visible: true,
      }),
    },
    { retry: true }, // read-only constant call
  );
  return res.constant_result?.[0];
}

async function getTronBalance(
  address: string,
  contractAddress?: string,
): Promise<BalanceResult> {
  const cfg = getConfig();

  if (!contractAddress) {
    const account = await httpJson<TronAccount>(
      `${cfg.tronApiUrl}/wallet/getaccount`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, visible: true }),
      },
      { retry: true }, // read-only account lookup
    );
    const raw = BigInt(account.balance ?? 0);
    return {
      network: "tron",
      address,
      contractAddress: null,
      symbol: "TRX",
      decimals: 6,
      raw: raw.toString(),
      formatted: formatUnits(raw, 6),
    };
  }

  // ABI-encode balanceOf(address): the trigger endpoint (visible:true) resolves
  // the owner address; the parameter must be the 32-byte word of the queried
  // address. We ask the node to resolve it by passing the base58 through the
  // dedicated helper below.
  const paramWord = await tronBase58ToAbiWord(address);
  const [balHex, decHex, symHex] = await Promise.all([
    tronCall(address, contractAddress, "balanceOf(address)", paramWord),
    tronCall(address, contractAddress, "decimals()", ""),
    tronCall(address, contractAddress, "symbol()", ""),
  ]);
  const raw = hexWordToBigInt(balHex);
  const decimals = decHex ? Number(hexWordToBigInt(decHex)) : 6;
  const symbol = decodeAbiString(symHex) ?? "TRC20";
  return {
    network: "tron",
    address,
    contractAddress,
    symbol,
    decimals,
    raw: raw.toString(),
    formatted: formatUnits(raw, decimals),
  };
}

/**
 * Convert a base58 Tron address to a 32-byte ABI word (left-padded 20-byte
 * EVM-style address) suitable for a balanceOf(address) parameter.
 */
async function tronBase58ToAbiWord(base58: string): Promise<string> {
  const { default: bs58check } = await import("bs58check");
  const decoded = bs58check.decode(base58); // 0x41 + 20 bytes
  const hex = Buffer.from(decoded).toString("hex");
  const evm20 = hex.slice(2); // drop the 0x41 prefix
  return evm20.padStart(64, "0");
}

/** Native UTXO balance via an Esplora REST API (blockstream / litecoinspace style). */
async function getEsploraBalance(
  network: "bitcoin" | "litecoin",
  apiBase: string,
  address: string,
): Promise<BalanceResult> {
  interface EsploraAddr {
    chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
    mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
  }
  const info = await httpJson<EsploraAddr>(`${apiBase}/address/${address}`, {
    method: "GET",
  });
  const chain = info.chain_stats ?? {};
  const mem = info.mempool_stats ?? {};
  const sats =
    BigInt(chain.funded_txo_sum ?? 0) -
    BigInt(chain.spent_txo_sum ?? 0) +
    BigInt(mem.funded_txo_sum ?? 0) -
    BigInt(mem.spent_txo_sum ?? 0);
  return {
    network,
    address,
    contractAddress: null,
    symbol: NATIVE_SYMBOL[network],
    decimals: 8,
    raw: sats.toString(),
    formatted: formatUnits(sats, 8),
  };
}

async function getBitcoinBalance(address: string): Promise<BalanceResult> {
  return getEsploraBalance("bitcoin", getConfig().bitcoinApiUrl, address);
}

async function getLitecoinBalance(address: string): Promise<BalanceResult> {
  return getEsploraBalance("litecoin", getConfig().litecoinApiUrl, address);
}

/** Dogecoin native balance via BlockCypher (…/addrs/{addr}/balance). */
async function getDogeBalance(address: string): Promise<BalanceResult> {
  const cfg = getConfig();
  interface BlockCypherBal {
    balance?: number;
    final_balance?: number;
    unconfirmed_balance?: number;
  }
  const info = await httpJson<BlockCypherBal>(
    `${cfg.dogeApiUrl}/addrs/${encodeURIComponent(address)}/balance`,
    { method: "GET" },
  );
  // Prefer confirmed+unconfirmed final_balance when present.
  const koinu = BigInt(info.final_balance ?? info.balance ?? 0);
  return {
    network: "doge",
    address,
    contractAddress: null,
    symbol: "DOGE",
    decimals: 8,
    raw: koinu.toString(),
    formatted: formatUnits(koinu, 8),
  };
}

/** JSON-RPC helper for chains that speak the standard JSON-RPC 2.0 envelope. */
async function jsonRpc<T>(url: string, method: string, params: unknown): Promise<T> {
  const res = await httpJson<{ result?: T; error?: { message?: string } }>(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    },
    { retry: true },
  );
  if (res.error) throw new Error(`RPC ${method} failed: ${res.error.message}`);
  return res.result as T;
}

/** Solana native SOL (lamports) or SPL token balance for `mint`. */
async function getSolanaBalance(address: string, mint?: string): Promise<BalanceResult> {
  if (mint) return getSolanaSplBalance(address, mint);
  const cfg = getConfig();
  const res = await jsonRpc<{ value: number }>(cfg.solanaRpcUrl, "getBalance", [address]);
  const lamports = BigInt(res?.value ?? 0);
  return {
    network: "solana",
    address,
    contractAddress: null,
    symbol: "SOL",
    decimals: 9,
    raw: lamports.toString(),
    formatted: formatUnits(lamports, 9),
  };
}

interface SplTokenAmount {
  amount?: string;
  decimals?: number;
}

interface SplParsedInfo {
  decimals?: number;
  tokenAmount?: SplTokenAmount;
}

interface SplParsedData {
  parsed?: { info?: SplParsedInfo; type?: string };
}

async function getSolanaMintDecimals(mint: string): Promise<number> {
  const cfg = getConfig();
  const res = await jsonRpc<{ value?: { data?: SplParsedData } | null }>(
    cfg.solanaRpcUrl,
    "getAccountInfo",
    [mint, { encoding: "jsonParsed", commitment: "confirmed" }],
  );
  const parsed = res?.value?.data?.parsed;
  if (parsed?.type === "mint" && typeof parsed.info?.decimals === "number") {
    return parsed.info.decimals;
  }
  throw new Error(`Solana mint ${mint} was not found or is not a token mint.`);
}

/** Sum SPL token accounts for `mint`. Missing ATA is a zero balance, not an error. */
async function getSolanaSplBalance(address: string, mint: string): Promise<BalanceResult> {
  const cfg = getConfig();
  const [accounts, decimals] = await Promise.all([
    jsonRpc<{
      value?: Array<{ account?: { data?: SplParsedData } }>;
    }>(cfg.solanaRpcUrl, "getTokenAccountsByOwner", [
      address,
      { mint },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]),
    getSolanaMintDecimals(mint),
  ]);
  let raw = 0n;
  for (const item of accounts?.value ?? []) {
    const amt = item.account?.data?.parsed?.info?.tokenAmount?.amount;
    if (amt) raw += BigInt(amt);
  }
  return {
    network: "solana",
    address,
    contractAddress: mint,
    symbol: "SPL",
    decimals,
    raw: raw.toString(),
    formatted: formatUnits(raw, decimals),
  };
}

/** TON native (nanotons) or jetton balance for `jettonMaster`. */
async function getTonBalance(address: string, jettonMaster?: string): Promise<BalanceResult> {
  if (jettonMaster) return getTonJettonBalance(address, jettonMaster);
  const cfg = getConfig();
  const res = await httpJson<{ ok?: boolean; result?: string; error?: string }>(
    `${cfg.tonApiUrl}/getAddressBalance?address=${encodeURIComponent(address)}`,
    { method: "GET" },
  );
  if (res.ok === false) throw new Error(`TON balance failed: ${res.error}`);
  const nano = BigInt(res.result ?? "0");
  return {
    network: "ton",
    address,
    contractAddress: null,
    symbol: "TON",
    decimals: 9,
    raw: nano.toString(),
    formatted: formatUnits(nano, 9),
  };
}

function tonClient(): TonClient {
  const cfg = getConfig();
  const apiKey = process.env.IW_TON_API_KEY?.trim();
  return new TonClient({
    endpoint: `${cfg.tonApiUrl.replace(/\/$/, "")}/jsonRPC`,
    ...(apiKey ? { apiKey } : {}),
  });
}

/** `https://toncenter.com/api/v2` → `https://toncenter.com/api/v3`. Null if the URL is not a v2 TonCenter-style path. */
function toncenterV3Base(v2Url: string): string | null {
  const base = v2Url.replace(/\/$/, "");
  if (!base.endsWith("/api/v2")) return null;
  return `${base.slice(0, -1)}3`;
}

function tonApiHeaders(): Record<string, string> | undefined {
  const apiKey = process.env.IW_TON_API_KEY?.trim();
  return apiKey ? { "X-Api-Key": apiKey } : undefined;
}

function normalizeJettonSymbol(symbol: string): string {
  return symbol.replaceAll("₮", "T");
}

interface ToncenterV3JettonWallets {
  jetton_wallets?: Array<{ balance?: string; jetton?: string }>;
  metadata?: Record<
    string,
    {
      token_info?: Array<{
        type?: string;
        symbol?: string;
        extra?: { decimals?: unknown };
      }>;
    }
  >;
}

function v3JettonMeta(
  res: ToncenterV3JettonWallets,
  master: Address,
): { decimals: number; symbol: string } {
  for (const [raw, entry] of Object.entries(res.metadata ?? {})) {
    try {
      if (!Address.parse(raw).equals(master)) continue;
    } catch {
      continue;
    }
    const info = entry.token_info?.find((t) => t.type === "jetton_masters") ?? entry.token_info?.[0];
    const symbol =
      typeof info?.symbol === "string" && info.symbol.length > 0
        ? normalizeJettonSymbol(info.symbol)
        : "JETTON";
    return { decimals: clampJettonDecimals(info?.extra?.decimals), symbol };
  }
  return { decimals: 9, symbol: "JETTON" };
}

/** Indexed jetton balance. Returns null when this Ton API has no v3 (caller falls back on-chain). */
async function getTonJettonBalanceIndexed(
  owner: string,
  jettonMaster: string,
): Promise<BalanceResult | null> {
  const cfg = getConfig();
  const v3 = toncenterV3Base(cfg.tonApiUrl);
  if (!v3) return null;
  const masterAddr = Address.parse(jettonMaster);
  const url =
    `${v3}/jetton/wallets?owner_address=${encodeURIComponent(owner)}` +
    `&jetton_address=${encodeURIComponent(jettonMaster)}&limit=16`;
  let res: ToncenterV3JettonWallets;
  try {
    res = await httpJson<ToncenterV3JettonWallets>(
      url,
      { method: "GET", headers: tonApiHeaders() },
      { retry: true, label: "ton.jetton.wallets" },
    );
  } catch {
    return null;
  }
  const wallets = res.jetton_wallets ?? [];
  if (wallets.length === 0) return null;
  const meta = v3JettonMeta(res, masterAddr);
  let raw = 0n;
  let matched = 0;
  for (const wallet of wallets) {
    if (!wallet.jetton || wallet.balance == null) continue;
    try {
      if (!Address.parse(wallet.jetton).equals(masterAddr)) continue;
    } catch {
      continue;
    }
    try {
      raw += BigInt(wallet.balance);
      matched++;
    } catch {
      continue;
    }
  }
  if (matched === 0) return null;
  logInfo("balance.ton.jetton.indexed", {
    owner,
    jettonMaster,
    raw: raw.toString(),
    symbol: meta.symbol,
    decimals: meta.decimals,
    wallets: res.jetton_wallets?.length ?? 0,
  });
  return {
    network: "ton",
    address: owner,
    contractAddress: jettonMaster,
    symbol: meta.symbol,
    decimals: meta.decimals,
    raw: raw.toString(),
    formatted: formatUnits(raw, meta.decimals),
  };
}

function sha256Key(name: string): bigint {
  return BigInt(`0x${Buffer.from(sha256(new TextEncoder().encode(name))).toString("hex")}`);
}

function clampJettonDecimals(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? ""));
  if (!Number.isInteger(n) || n < 0 || n > 18) return 9;
  return n;
}

async function fetchOffchainJettonMeta(uri: string): Promise<{ decimals: number; symbol: string }> {
  const url = uri.startsWith("ipfs://")
    ? `https://ipfs.io/ipfs/${uri.slice("ipfs://".length)}`
    : uri;
  const json = await httpJson<{ decimals?: unknown; symbol?: unknown }>(
    url,
    { method: "GET" },
    { retry: true, label: "ton.jetton.meta" },
  );
  return {
    decimals: clampJettonDecimals(json.decimals),
    symbol: typeof json.symbol === "string" && json.symbol.length > 0 ? json.symbol : "JETTON",
  };
}

function readOnchainSnake(cell: Cell): string {
  const s = cell.beginParse();
  if (s.remainingBits >= 8) {
    const tag = s.preloadUint(8);
    if (tag === 0) s.loadUint(8);
  }
  return s.loadStringTail();
}

function parseOnchainJettonMeta(content: Cell): { decimals: number; symbol: string } {
  const slice = content.beginParse();
  slice.loadUint(8);
  const dict = slice.loadDict(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
  const decCell = dict.get(sha256Key("decimals"));
  const symCell = dict.get(sha256Key("symbol"));
  return {
    decimals: decCell ? clampJettonDecimals(readOnchainSnake(decCell)) : 9,
    symbol: symCell ? readOnchainSnake(symCell) || "JETTON" : "JETTON",
  };
}

async function jettonDecimalsAndSymbol(
  client: TonClient,
  master: Address,
): Promise<{ decimals: number; symbol: string }> {
  try {
    const data = await client.runMethod(master, "get_jetton_data");
    data.stack.readBigNumber();
    data.stack.readNumber();
    data.stack.readAddress();
    const content = data.stack.readCell();
    const cs = content.beginParse();
    if (cs.remainingBits < 8) return { decimals: 9, symbol: "JETTON" };
    const layout = cs.loadUint(8);
    if (layout === 1) {
      return await fetchOffchainJettonMeta(cs.loadStringTail());
    }
    if (layout === 0) {
      return parseOnchainJettonMeta(content);
    }
  } catch {
    // TEP-64 metadata is optional for the fee check; raw wallet units still match Relay.
  }
  return { decimals: 9, symbol: "JETTON" };
}

function isTonAccountUndeployed(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.message} ${e.name}` : String(e);
  return /uninit|not initialized|inactive/i.test(msg) || /exit_code[^\d-]*(-1[13]|0)\b/i.test(msg);
}

/** Jetton units from the owner's jetton wallet. Undeployed wallet is balance 0. */
async function getTonJettonBalance(owner: string, jettonMaster: string): Promise<BalanceResult> {
  const indexed = await getTonJettonBalanceIndexed(owner, jettonMaster);
  if (indexed) return indexed;

  const client = tonClient();
  const ownerAddr = Address.parse(owner);
  const masterAddr = Address.parse(jettonMaster);
  const ownerCell = beginCell().storeAddress(ownerAddr).endCell();
  const walletRes = await client.runMethod(masterAddr, "get_wallet_address", [
    { type: "slice", cell: ownerCell },
  ]);
  const jettonWallet = walletRes.stack.readAddress();
  const meta = await jettonDecimalsAndSymbol(client, masterAddr);
  let raw = 0n;
  try {
    const walletData = await client.runMethod(jettonWallet, "get_wallet_data");
    raw = walletData.stack.readBigNumber();
  } catch (e) {
    if (!isTonAccountUndeployed(e)) throw e;
    raw = 0n;
  }
  return {
    network: "ton",
    address: owner,
    contractAddress: jettonMaster,
    symbol: meta.symbol,
    decimals: meta.decimals,
    raw: raw.toString(),
    formatted: formatUnits(raw, meta.decimals),
  };
}

/** XRP native balance (drops) via account_info. Unfunded accounts read as 0. */
async function getXrpBalance(address: string): Promise<BalanceResult> {
  const cfg = getConfig();
  interface XrpInfo {
    account_data?: { Balance?: string };
    error?: string;
  }
  const res = await httpJson<{ result?: XrpInfo }>(
    cfg.xrpRpcUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "account_info",
        params: [{ account: address, ledger_index: "validated" }],
      }),
    },
    { retry: true },
  );
  const info = res.result ?? {};
  // actNotFound => account not yet funded => zero balance.
  const drops = info.error === "actNotFound" ? 0n : BigInt(info.account_data?.Balance ?? 0);
  return {
    network: "xrp",
    address,
    contractAddress: null,
    symbol: "XRP",
    decimals: 6,
    raw: drops.toString(),
    formatted: formatUnits(drops, 6),
  };
}

/** Read the on-chain balance for a wallet address on the given network. */
export async function getBalance(
  network: NetworkId,
  address: string,
  contractAddress?: string,
): Promise<BalanceResult> {
  const started = Date.now();
  logInfo("balance.start", { network, address, contractAddress });
  try {
    let result: BalanceResult;
    if (isEvmNetwork(network)) {
      result = await getEvmBalance(network, address, contractAddress);
    } else {
      switch (network) {
        case "tron":
          result = await getTronBalance(address, contractAddress);
          break;
        case "bitcoin":
          result = await getBitcoinBalance(address);
          break;
        case "litecoin":
          result = await getLitecoinBalance(address);
          break;
        case "doge":
          result = await getDogeBalance(address);
          break;
        case "solana":
          result = await getSolanaBalance(address, contractAddress);
          break;
        case "ton":
          result = await getTonBalance(address, contractAddress);
          break;
        case "xrp":
          result = await getXrpBalance(address);
          break;
        default:
          throw new Error(`Unsupported network for balance: ${network}`);
      }
    }
    logInfo("balance.ok", {
      network,
      address,
      contractAddress: result.contractAddress,
      symbol: result.symbol,
      decimals: result.decimals,
      raw: result.raw,
      formatted: result.formatted,
      elapsedMs: Date.now() - started,
    });
    return result;
  } catch (e) {
    logError("balance.fail", e, {
      network,
      address,
      contractAddress,
      elapsedMs: Date.now() - started,
    });
    throw e;
  }
}
