# usdtapi

Backend (Node.js + Express) that verifies **internal Binance USDT transfers**, awards equivalent KES, and stores each TxID so it can only be used once.

## Prerequisites

- Node.js >= 18
- Binance API key with **read** permission for Wallet / Deposit History

## Setup

1. Install and run:

   ```bash
   cd usdtapi
   npm install
   ```

2. Create `usdtapi/.env`:

   ```env
   BINANCE_API_KEY=your_api_key_here
   BINANCE_API_SECRET=your_secret_here
   PORT=4000
   NODE_ENV=development
   KES_PER_USDT=150  # initial rate (can be changed via API)
   ```

3. Start:

   ```bash
   npm start
   ```

The server listens on `http://localhost:4000`. Processed TxIDs are stored in **SQLite** at `usdtapi/data.db` (created on first run).

## Docker Setup

### Using Docker Compose (Recommended)

1. Ensure your `.env` file is configured with all required variables:
   ```env
   BINANCE_API_KEY=your_api_key_here
   BINANCE_API_SECRET=your_secret_here
   PORT=4000
   NODE_ENV=production
   KES_PER_USDT=150
   MIN_DEPOSIT_AMOUNT=0
   MIN_WITHDRAWAL_AMOUNT=10
   ```

2. Build and start the container:
   ```bash
   docker-compose up -d
   ```

3. View logs:
   ```bash
   docker-compose logs -f
   ```

4. Stop the container:
   ```bash
   docker-compose down
   ```

The database will be persisted in the `./data` directory.

### Using Docker directly

1. Build the image:
   ```bash
   docker build -t usdtapi .
   ```

2. Run the container:
   ```bash
   docker run -d \
     --name usdtapi \
     -p 4000:4000 \
     -e BINANCE_API_KEY=your_api_key \
     -e BINANCE_API_SECRET=your_secret \
     -e KES_PER_USDT=150 \
     -e MIN_DEPOSIT_AMOUNT=0 \
     -e MIN_WITHDRAWAL_AMOUNT=10 \
     -v $(pwd)/data:/app/data \
     usdtapi
   ```

## API

### `GET /api/health`

Returns `{ "ok": true }`.

### `POST /api/deposit/txid`

Verify a transaction ID and award KES. Each TxID is stored; if the same TxID is sent again, the request is rejected.

**Request body:**

```json
{
  "txId": "Off-chain transfer 344178838453"
}
```

- **txId** (required): The exact string from Binance (e.g. `Off-chain transfer 344178838453`).
- Minimum deposit amount is enforced server-side (see `GET/POST /api/min-deposit`).

**Response (confirmed):**

```json
{
  "status": "confirmed",
  "confirmedAmount": 9,
  "confirmedAt": "2026-01-22T08:11:24.000Z",
  "rewardKes": 1350
}
```

**Response (TxID already used):** `400` with:

```json
{
  "error": "Transaction ID already used",
  "confirmedAmount": 9,
  "rewardKes": 1350,
  "confirmedAt": "2026-01-22T08:11:24.000Z"
}
```

**Response (not found yet):** `200` with:

```json
{
  "status": "waiting_confirmation",
  "message": "No matching deposit found yet. Please try again later."
}
```

### `GET /api/debug/deposits`

Returns recent USDT deposits from Binance (for checking exact `txId` format). **Only available when `NODE_ENV=development`**; returns 404 in production.

## Database

- **SQLite** file: `usdtapi/data.db`
- Table: `processed_transactions` (`txId` UNIQUE, `asset`, `amount`, `rewardKes`, `confirmedAt`, `createdAt`)
- Table: `settings` (key/value), used to store `KES_PER_USDT` so it persists across restarts.
- Optional: set `SQLITE_DB_PATH` in `.env` to use a different path.

## Frontend flow

1. User does an internal Binance USDT transfer to your account.
2. User copies the TxID (e.g. `Off-chain transfer 344178838453`) and pastes it in your UI.
3. Your frontend calls `POST /api/deposit/txid` with `{ "txId": "..." }`.
4. If confirmed, show `rewardKes`; if “Transaction ID already used”, show that message.

No sessions or user accounts required.
# usdtapi
# usdtapi
