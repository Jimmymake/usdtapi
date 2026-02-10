const crypto = require("crypto");
const axios = require("axios");

const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;

if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
  // Do not throw here to allow the app to start, but log clearly.
  // Requests that actually hit Binance will fail and return a 500.
  // This keeps local dev smoother while still warning loudly.
  // eslint-disable-next-line no-console
  console.warn(
    "[usdtapi] BINANCE_API_KEY or BINANCE_API_SECRET is not set. Binance calls will fail."
  );
}

const BINANCE_BASE_URL = "https://api.binance.com";

/**
 * Create a signed Binance query string with HMAC SHA256.
 * @param {Record<string, string | number>} params
 */
function signParams(params) {
  const query = Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const signature = crypto
    .createHmac("sha256", BINANCE_API_SECRET || "")
    .update(query)
    .digest("hex");

  return `${query}&signature=${signature}`;
}

/**
 * Call Binance GET signed endpoint.
 * @param {string} path
 * @param {Record<string, string | number>} params
 */
async function binanceGet(path, params) {
  if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
    throw new Error("Binance API credentials are not configured");
  }

  const timestamp = Date.now();
  // Give some leeway for small clock drift.
  const signedQuery = signParams({ recvWindow: 60000, ...params, timestamp });
  const url = `${BINANCE_BASE_URL}${path}?${signedQuery}`;

  const response = await axios.get(url, {
    headers: {
      "X-MBX-APIKEY": BINANCE_API_KEY,
    },
    timeout: 10_000,
  });

  return response.data;
}

/**
 * Call Binance POST signed endpoint.
 * @param {string} path
 * @param {Record<string, string | number>} params
 */
async function binancePost(path, params) {
  if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
    throw new Error("Binance API credentials are not configured");
  }

  const timestamp = Date.now();
  // Give some leeway for small clock drift.
  const signedQuery = signParams({ recvWindow: 60000, ...params, timestamp });
  const url = `${BINANCE_BASE_URL}${path}?${signedQuery}`;

  const response = await axios.post(url, null, {
    headers: {
      "X-MBX-APIKEY": BINANCE_API_KEY,
    },
    timeout: 10_000,
  });

  return response.data;
}

/**
 * Fetch deposit history for a given coin.
 * Documentation: GET /sapi/v1/capital/deposit/hisrec
 *
 * @param {object} options
 * @param {string} options.coin - e.g. "USDT"
 * @param {number} [options.startTime] - ms timestamp
 * @param {number} [options.endTime] - ms timestamp
 * @param {number} [options.limit] - default 1000
 * @returns {Promise<Array<any>>}
 */
async function getDepositHistory({ coin, startTime, endTime, limit = 1000 }) {
  const params = { coin, limit };
  if (startTime) params.startTime = startTime;
  if (endTime) params.endTime = endTime;

  const data = await binanceGet("/sapi/v1/capital/deposit/hisrec", params);
  if (!Array.isArray(data)) {
    throw new Error("Unexpected Binance deposit history response format");
  }
  return data;
}

/**
 * Get USDT balance from spot wallet.
 * Documentation: GET /api/v3/account
 * @returns {Promise<number>} Available USDT balance (free amount)
 */
async function getUSDTBalance() {
  const account = await binanceGet("/api/v3/account", {});
  
  if (!account || !Array.isArray(account.balances)) {
    throw new Error("Unexpected Binance account response format");
  }
  
  const usdtBalance = account.balances.find((b) => b.asset === "USDT");
  
  if (!usdtBalance) {
    return 0;
  }
  
  return Number(usdtBalance.free || 0);
}

/**
 * Withdraw USDT to address (supports TRC20 and Solana).
 * Documentation: POST /sapi/v1/capital/withdraw/apply
 * @param {object} options
 * @param {string} options.address - Address (TRC20 or Solana)
 * @param {number} options.amount - Amount to withdraw
 * @param {string} [options.network] - Network ("TRX" for TRC20, "SOL" for Solana). Auto-detected if not provided.
 * @returns {Promise<{id: string}>}
 */
async function withdrawUSDT({ address, amount, network }) {
  // Auto-detect network if not provided
  let detectedNetwork = network;
  if (!detectedNetwork) {
    // TRC20 addresses start with T and are 34 chars
    if (/^T[A-Za-z1-9]{33}$/.test(address)) {
      detectedNetwork = "TRX";
    }
    // Solana addresses are base58, typically 32-44 chars
    else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      detectedNetwork = "SOL";
    }
    else {
      throw new Error("Unable to detect network from address format. Please specify network.");
    }
  }

  const params = {
    coin: "USDT",
    network: detectedNetwork,
    address,
    amount,
  };

  return await binancePost("/sapi/v1/capital/withdraw/apply", params);
}

module.exports = {
  getDepositHistory,
  getUSDTBalance,
  withdrawUSDT,
};

