const Database = require("better-sqlite3");
const path = require("path");

const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, "..", "data.db");
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS processed_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    txId TEXT NOT NULL UNIQUE,
    asset TEXT NOT NULL,
    amount REAL NOT NULL,
    rewardKes REAL NOT NULL,
    confirmedAt TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_processed_transactions_txId ON processed_transactions(txId);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

function getByTxId(txId) {
  const row = db.prepare("SELECT * FROM processed_transactions WHERE txId = ?").get(txId);
  return row || null;
}

function insert(record) {
  const stmt = db.prepare(`
    INSERT INTO processed_transactions (txId, asset, amount, rewardKes, confirmedAt)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    record.txId,
    record.asset,
    record.amount,
    record.rewardKes,
    record.confirmedAt
  );
  return result;
}

function getSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
}

module.exports = { getByTxId, insert, getSetting, setSetting };
