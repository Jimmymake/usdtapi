#!/usr/bin/env node
/**
 * Clears all data from the SQLite database (processed_transactions and settings).
 * Uses the same DB path as the app (SQLITE_DB_PATH or usdtapi/data.db).
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dbPath =
  process.env.SQLITE_DB_PATH || path.join(__dirname, "..", "data.db");

// Check if database file exists
if (!fs.existsSync(dbPath)) {
  console.error("Database file not found at:", dbPath);
  console.error("Please check SQLITE_DB_PATH in .env or ensure data.db exists in the project root.");
  process.exit(1);
}

const db = new Database(dbPath);

// Ensure tables exist (they will be created if they don't exist)
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
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Clear all data
const txCount = db.prepare("SELECT COUNT(*) as count FROM processed_transactions").get().count;
const settingsCount = db.prepare("SELECT COUNT(*) as count FROM settings").get().count;

db.exec(`
  DELETE FROM processed_transactions;
  DELETE FROM settings;
`);

console.log(`Cleared ${txCount} transactions and ${settingsCount} settings from: ${dbPath}`);
db.close();
