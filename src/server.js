require("dotenv").config();

const express = require("express");
const { getDepositHistory, getUSDTBalance, withdrawUSDT } = require("./binanceClient");
const { getByTxId, insert, getSetting, setSetting } = require("./db");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());

// Load rate from DB if present, otherwise from env/default and persist it.
let KES_PER_USDT = (() => {
  const fromDb = getSetting("KES_PER_USDT");
  if (fromDb != null) {
    const n = Number(fromDb);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  const fromEnv = Number(process.env.KES_PER_USDT || "150");
  const initial = !Number.isNaN(fromEnv) && fromEnv > 0 ? fromEnv : 150;
  setSetting("KES_PER_USDT", initial);
  return initial;
})();

// Load minimum deposit amount from DB if present, otherwise from env/default and persist it.
let MIN_DEPOSIT_AMOUNT = (() => {
  const fromDb = getSetting("MIN_DEPOSIT_AMOUNT");
  if (fromDb != null) {
    const n = Number(fromDb);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  const fromEnv = Number(process.env.MIN_DEPOSIT_AMOUNT || "0");
  const initial = !Number.isNaN(fromEnv) && fromEnv >= 0 ? fromEnv : 0;
  setSetting("MIN_DEPOSIT_AMOUNT", initial);
  return initial;
})();

// Load minimum withdrawal amount from DB if present, otherwise from env/default and persist it.
let MIN_WITHDRAWAL_AMOUNT = (() => {
  const fromDb = getSetting("MIN_WITHDRAWAL_AMOUNT");
  if (fromDb != null) {
    const n = Number(fromDb);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  const fromEnv = Number(process.env.MIN_WITHDRAWAL_AMOUNT || "10");
  const initial = !Number.isNaN(fromEnv) && fromEnv > 0 ? fromEnv : 10;
  setSetting("MIN_WITHDRAWAL_AMOUNT", initial);
  return initial;
})();

/**
 * Health check
 */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

/**
 * GET /api/rate
 * Returns the current KES_PER_USDT rate.
 */
app.get("/api/rate", (_req, res) => {
  res.json({ rate: KES_PER_USDT });
});

/**
 * POST /api/rate
 * Body: { rate: number }
 * Updates the KES_PER_USDT rate and persists it.
 */
app.post("/api/rate", (req, res) => {
  const { rate } = req.body || {};
  const n = Number(rate);
  if (!rate || Number.isNaN(n) || n <= 0) {
    return res.status(400).json({ error: "rate must be a positive number" });
  }

  KES_PER_USDT = n;
  setSetting("KES_PER_USDT", n);

  return res.json({ rate: KES_PER_USDT });
});

/**
 * GET /api/min-deposit
 * Returns the current minimum deposit amount (USDT).
 */
app.get("/api/min-deposit", (_req, res) => {
  res.json({ minDepositAmount: MIN_DEPOSIT_AMOUNT });
});

/**
 * POST /api/min-deposit
 * Body: { minDepositAmount: number }
 * Updates the minimum deposit amount and persists it.
 */
app.post("/api/min-deposit", (req, res) => {
  const { minDepositAmount } = req.body || {};
  const n = Number(minDepositAmount);
  if (minDepositAmount == null || Number.isNaN(n) || n < 0) {
    return res.status(400).json({ error: "minDepositAmount must be a non-negative number" });
  }

  MIN_DEPOSIT_AMOUNT = n;
  setSetting("MIN_DEPOSIT_AMOUNT", n);

  return res.json({ minDepositAmount: MIN_DEPOSIT_AMOUNT });
});

/**
 * GET /api/min-withdrawal
 * Returns the current minimum withdrawal amount (USDT).
 */
app.get("/api/min-withdrawal", (_req, res) => {
  res.json({ minWithdrawalAmount: MIN_WITHDRAWAL_AMOUNT });
});

/**
 * POST /api/min-withdrawal
 * Body: { minWithdrawalAmount: number }
 * Updates the minimum withdrawal amount and persists it.
 */
app.post("/api/min-withdrawal", (req, res) => {
  const { minWithdrawalAmount } = req.body || {};
  const n = Number(minWithdrawalAmount);
  if (minWithdrawalAmount == null || Number.isNaN(n) || n <= 0) {
    return res.status(400).json({ error: "minWithdrawalAmount must be a positive number" });
  }

  MIN_WITHDRAWAL_AMOUNT = n;
  setSetting("MIN_WITHDRAWAL_AMOUNT", n);

  return res.json({ minWithdrawalAmount: MIN_WITHDRAWAL_AMOUNT });
});

/**
 * POST /api/deposit/txid
 * Body: { txId: string }
 * Verifies the TxID with Binance, awards KES, and stores it so the TxID cannot be used again.
 * Minimum deposit amount is enforced server-side (configured via MIN_DEPOSIT_AMOUNT setting).
 */
app.post("/api/deposit/txid", async (req, res) => {
  const { txId } = req.body || {};

  if (!txId || typeof txId !== "string") {
    return res.status(400).json({ error: "txId is required" });
  }

  const txIdTrimmed = txId.trim();
  if (!txIdTrimmed) {
    return res.status(400).json({ error: "txId is required" });
  }

  // Normalize txId: if it doesn't start with "Off-chain transfer ", prepend it
  const OFF_CHAIN_PREFIX = "Off-chain transfer ";
  const normalizedTxId = txIdTrimmed.startsWith(OFF_CHAIN_PREFIX)
    ? txIdTrimmed
    : `${OFF_CHAIN_PREFIX}${txIdTrimmed}`;

  // Reject if this TxID was already processed (persists across restarts)
  // Check both normalized and original versions
  const existing = getByTxId(normalizedTxId) || getByTxId(txIdTrimmed);
  if (existing) {
    return res.json({
      status: "failed",
      reason: "already_used",
      message: "Transaction ID already used",
      confirmedAmount: existing.amount,
      rewardKes: existing.rewardKes,
      confirmedAt: existing.confirmedAt,
    });
  }

  try {
    const deposits = await getDepositHistory({
      coin: "USDT",
      limit: 1000,
    });

    // Search for both normalized and original versions in Binance deposits
    const match = deposits.find(
      (d) =>
        d &&
        typeof d.txId === "string" &&
        (d.txId === normalizedTxId ||
          d.txId.trim() === normalizedTxId ||
          d.txId === txIdTrimmed ||
          d.txId.trim() === txIdTrimmed) &&
        Number(d.status) === 1
    );

    if (!match) {
      return res.json({
        status: "failed",
        reason: "not_found",
        message: "Transaction not found or does not exist",
      });
    }

    const confirmedAmount = Number(match.amount || 0);
    if (MIN_DEPOSIT_AMOUNT > 0 && confirmedAmount < MIN_DEPOSIT_AMOUNT) {
      return res.json({
        status: "failed",
        reason: "amount_too_low",
        message: `Deposit amount ${confirmedAmount} USDT is below minimum ${MIN_DEPOSIT_AMOUNT} USDT`,
        minDepositAmount: MIN_DEPOSIT_AMOUNT,
        confirmedAmount,
      });
    }

    const rewardKes = confirmedAmount * KES_PER_USDT;
    const confirmedAt = new Date(match.insertTime || Date.now()).toISOString();

    // Store the normalized version (with "Off-chain transfer " prefix) in the database
    insert({
      txId: normalizedTxId,
      asset: "USDT",
      amount: confirmedAmount,
      rewardKes,
      confirmedAt,
    });

    return res.json({
      status: "complete",
      confirmedAmount,
      confirmedAt,
      rewardKes,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[usdtapi] Error verifying txId", err.message || err);
    const statusCode = err.response && err.response.status;
    const binanceData = err.response && err.response.data;
    if (binanceData) {
      // eslint-disable-next-line no-console
      console.error("[usdtapi] Binance error response:", binanceData);
    }
    // HTTP 451 = Unavailable For Legal Reasons (e.g. region/jurisdiction restriction)
    if (statusCode === 451) {
      return res.json({
        status: "failed",
        reason: "region_restricted",
        message: "Binance API is not available in this region. Access may be restricted by jurisdiction.",
        binanceMessage: binanceData && (binanceData.msg || binanceData.message),
      });
    }
    const binanceMsg = binanceData && (binanceData.msg || binanceData.message);
    return res.json({
      status: "failed",
      reason: "verification_error",
      message: binanceMsg || "Failed to verify transaction with Binance",
      details:
        process.env.NODE_ENV === "development" ? String(err.message || err) : undefined,
    });
  }
});

/**
 * POST /api/withdraw
 * Body: { address: string, amount?: number, network?: string }
 * Withdraws USDT to the provided address (supports TRC20 and Solana).
 * - address: Address (TRC20 or Solana) (required)
 * - amount: Amount in USDT (optional, if not provided withdraws all available USDT)
 * - network: Network type "TRX" or "SOL" (optional, auto-detected from address format)
 * No authentication required. Errors only occur when Binance returns insufficient funds.
 */
app.post("/api/withdraw", async (req, res) => {
  const { address, amount, network } = req.body || {};

  if (!address || typeof address !== "string") {
    return res.status(400).json({ error: "address is required" });
  }

  const addressTrimmed = address.trim();
  if (!addressTrimmed) {
    return res.status(400).json({ error: "address is required" });
  }

  // Detect network if not provided
  let detectedNetwork = network;
  if (!detectedNetwork) {
    // TRC20 addresses start with T and are 34 chars
    if (/^T[A-Za-z1-9]{33}$/.test(addressTrimmed)) {
      detectedNetwork = "TRX";
    }
    // Solana addresses are base58, typically 32-44 chars
    else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addressTrimmed)) {
      detectedNetwork = "SOL";
    }
    else {
      return res.status(400).json({ 
        error: "Invalid address format. Supported networks: TRC20 (starts with T, 34 chars) or Solana (32-44 base58 chars)" 
      });
    }
  }

  // Validate network if explicitly provided
  if (network && network !== "TRX" && network !== "SOL") {
    return res.status(400).json({ error: "network must be 'TRX' (TRC20) or 'SOL' (Solana)" });
  }

  // Validate amount if provided (amount is in USDT)
  let withdrawalAmount = null;
  if (amount != null) {
    withdrawalAmount = Number(amount);
    if (Number.isNaN(withdrawalAmount) || withdrawalAmount <= 0) {
      return res.status(400).json({ error: "amount must be a positive number (in USDT)" });
    }
  }

  try {
    // Get USDT balance
    const availableAmount = await getUSDTBalance();
    
    if (availableAmount <= 0) {
      return res.json({
        status: "failed",
        reason: "insufficient_funds",
        message: "Insufficient USDT balance",
        availableAmount: 0,
        availableAmountUnit: "USDT",
      });
    }

    // Use provided amount or all available balance
    const finalAmount = withdrawalAmount !== null ? withdrawalAmount : availableAmount;

    // Check minimum withdrawal amount
    if (finalAmount < MIN_WITHDRAWAL_AMOUNT) {
      return res.json({
        status: "failed",
        reason: "amount_below_minimum",
        message: `Withdrawal amount ${finalAmount} USDT is below minimum ${MIN_WITHDRAWAL_AMOUNT} USDT`,
        requestedAmount: finalAmount,
        minWithdrawalAmount: MIN_WITHDRAWAL_AMOUNT,
        amountUnit: "USDT",
      });
    }

    // Check if requested amount exceeds available balance
    if (finalAmount > availableAmount) {
      return res.json({
        status: "failed",
        reason: "insufficient_funds",
        message: `Requested amount ${finalAmount} USDT exceeds available balance ${availableAmount} USDT`,
        requestedAmount: finalAmount,
        requestedAmountUnit: "USDT",
        availableAmount,
        availableAmountUnit: "USDT",
      });
    }

    // Attempt withdrawal
    const result = await withdrawUSDT({
      address: addressTrimmed,
      amount: finalAmount,
      network: detectedNetwork,
    });

    return res.json({
      status: "complete",
      withdrawalId: result.id,
      amount: finalAmount,
      amountUnit: "USDT",
      address: addressTrimmed,
      network: detectedNetwork,
      message: "Withdrawal initiated successfully",
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[usdtapi] Error processing withdrawal", err.message || err);
    
    // Check if it's a Binance API error
    if (err.response && err.response.data) {
      const binanceError = err.response.data;
      // eslint-disable-next-line no-console
      console.error("[usdtapi] Binance error response:", binanceError);
      
      // Check for insufficient funds error
      const errorMsg = String(binanceError.msg || binanceError.message || err.message || "").toLowerCase();
      if (errorMsg.includes("insufficient") || errorMsg.includes("balance") || errorMsg.includes("fund")) {
        return res.json({
          status: "failed",
          reason: "insufficient_funds",
          message: binanceError.msg || "Insufficient funds",
        });
      }
      
      return res.json({
        status: "failed",
        reason: "withdrawal_error",
        message: binanceError.msg || "Withdrawal failed",
        details: process.env.NODE_ENV === "development" ? String(err.message || err) : undefined,
      });
    }

    return res.json({
      status: "failed",
      reason: "withdrawal_error",
      message: "Failed to process withdrawal",
      details: process.env.NODE_ENV === "development" ? String(err.message || err) : undefined,
    });
  }
});

/**
 * GET /api/debug/deposits
 * Returns recent USDT deposit records from Binance. Only when NODE_ENV=development.
 */
app.get("/api/debug/deposits", async (req, res) => {
  if (process.env.NODE_ENV !== "development") {
    return res.status(404).json({ error: "Not found" });
  }
  try {
    const deposits = await getDepositHistory({
      coin: "USDT",
      limit: 50,
    });
    const safe = deposits.map((d) => ({
      txId: d.txId,
      amount: d.amount,
      status: d.status,
      insertTime: d.insertTime,
      network: d.network,
    }));
    return res.json({ count: safe.length, deposits: safe });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[usdtapi] Debug deposits error", err.message || err);
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[usdtapi] Server listening on http://localhost:${PORT}`);
});
