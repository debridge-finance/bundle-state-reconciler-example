# deBridge Bundle State Sync

A reference implementation for maintaining a local PostgreSQL mirror of [deBridge](https://debridge.finance) gasless bundle states, with real-time WebSocket updates, REST polling backfill, and stale-bundle reconciliation.

## What's Inside

### [`bundle-state-sync/`](bundle-state-sync/)

The main sync service. Three workers provide layered coverage: a **WebSocket worker** for real-time push updates, a **Poller** for time-windowed REST backfill, and a **Reconciler** that re-checks stale non-terminal bundles with exponential backoff. All three converge on a single upsert function with an `updatedAt` guard so only newer data wins.

### [`mock-debridge-api/`](mock-debridge-api/)

A local mock of the deBridge Gasless API (REST + WebSocket) with deterministic bundle progression. Lets you run end-to-end tests without hitting production. Bundles advance through configurable state transitions on a timer, and a WebSocket server pushes updates to subscribed clients.

## Quick Start

Start the mock API, seed test data, run the sync service, and verify — all locally with no API key required.

```bash
# 1. Start mock API (Postgres on :5433, REST on :3000, WS on :3001)
cd mock-debridge-api
cp .env.example .env
docker compose up -d --build
cd ..

# 2. Start sync service (Postgres on :5432)
cd bundle-state-sync
cp .env.example .env
```

Edit `bundle-state-sync/.env` to point at the mock API:

```env
DEBRIDGE_API_URL=http://localhost:3000
DEBRIDGE_WS_URL=ws://localhost:3001
DEBRIDGE_API_KEY=test
REFERRAL_CODE=1000
```

```bash
# 3. Start sync service
docker compose up -d --build

# 4. Seed bundles, run sync, then verify
npm install
npm run producer     # seed 100 bundles into mock API
npm run dev          # start sync workers (Ctrl+C to stop)
npm run checker      # 3-way comparison: manifest vs mock DB vs sync DB
```

## Running Against Production

Set these environment variables in `bundle-state-sync/.env`:

```env
DEBRIDGE_API_URL=https://api-gaslessb2b.debridge.finance
DEBRIDGE_WS_URL=wss://api-gaslessb2b.debridge.finance/ws
DEBRIDGE_API_KEY=<your-production-api-key>
REFERRAL_CODE=<your-referral-code>
```

The API URLs above are already the defaults, so you only need to provide a valid `DEBRIDGE_API_KEY` and `REFERRAL_CODE`.

## Project Structure

```
bundle-state-reconciler-example/
├── bundle-state-sync/          # Main sync service
│   ├── src/
│   │   ├── workers/            # WebSocket, Poller, Reconciler
│   │   ├── db/                 # Migrations, store, queries
│   │   ├── producer.ts         # Test data seeder
│   │   ├── checker.ts          # 3-way verification tool
│   │   └── inject-bundle.ts    # Importable bundle injector
│   ├── docker-compose.yml
│   └── .env.example
├── mock-debridge-api/          # Mock deBridge API server
│   ├── src/
│   │   ├── services/           # Progression worker, WS server
│   │   ├── routes/             # REST endpoints
│   │   └── db/                 # Migrations, queries
│   ├── docker-compose.yml
│   └── .env.example
└── .nvmrc
```

## Documentation

- [bundle-state-sync README](bundle-state-sync/README.md) — architecture, worker details, database schema, configuration reference
- [mock-debridge-api README](mock-debridge-api/README.md) — API endpoints, WebSocket protocol, state transitions, smoke tests

## Prerequisites

- Node.js 20+ (see `.nvmrc`)
- Docker & Docker Compose
- A deBridge API key and referral code (for production use)
