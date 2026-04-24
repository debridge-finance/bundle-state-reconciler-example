# mock-debridge-api

A local mock that simulates the deBridge Gasless API (REST + WebSocket) with deterministic bundle progression. It lets you test `bundle-state-sync` workers and other consumers against realistic API shapes and state transitions without hitting production.

## What It Simulates

- **REST API** matching the production endpoint paths and response shapes (`/v1.1/gasless/bundles/submit`, `/v1/gasless/bundles/:bundleId`, `/v1/gasless/bundles`)
- **WebSocket server** that pushes `bundle_update` events on state transitions, with subscribe/unsubscribe semantics matching the production protocol
- **Deterministic progression** — you choose the target terminal status at submit time, and a background worker advances the bundle through intermediate states on a configurable timer

## Bundle Progression

A background worker (`src/services/progression-worker.ts`) polls every `PROGRESSION_INTERVAL_MS` (default 1 s) for bundles whose `updated_at` is older than `PROGRESSION_DELAY_MS` (default 5 s) and advances them toward their target status.

### State Transitions

**1-step** (created directly to terminal):

| `targetStatus` | Transition |
|---|---|
| `fulfilled` (default) | `created` &rarr; `fulfilled` |
| `cancelled` | `created` &rarr; `cancelled` (populates `cancel` JSONB) |
| `expired` | `created` &rarr; `expired` |
| `failed` | `created` &rarr; `failed` |

**2-step** (passes through `partially_fulfilled`):

| `targetStatus` | Transition |
|---|---|
| `partially_fulfilled` | `created` &rarr; `partially_fulfilled` &rarr; `fulfilled` |
| `partially_fulfilled_expired` | `created` &rarr; `partially_fulfilled` &rarr; `expired` |

Each arrow is one progression step, so 2-step paths take two delay cycles to reach their terminal state.

## WebSocket Server

Runs on port `WS_PORT` (default **3001**).

### Subscribe

```jsonc
// client → server
{
  "event": "subscribe",
  "data": {
    "filters": {
      "bundleId": ["0xabc...", "0xdef..."]
    }
  }
}
```

**Replace semantics** — each `subscribe` call replaces the entire subscription set (not additive). Max **100** bundleIds per connection; IDs beyond the limit are rejected with a `SUBSCRIPTION_LIMIT` error.

### Subscribe Acknowledgement

```jsonc
// server → client
{
  "event": "subscribe",
  "data": {
    "confirm": {
      "filters": { "bundleId": ["0xabc...", "0xdef..."] },
      "status": "subscribed",
      "timestamp": 1706000000000
    }
  }
}
```

### Unsubscribe

```jsonc
// client → server
{ "event": "unsubscribe", "data": { "filters": { "bundleId": ["0xabc..."] } } }

// server → client
{
  "event": "unsubscribed",
  "data": {
    "confirm": {
      "filters": { "bundleId": ["0xabc..."] },
      "status": "unsubscribed",
      "timestamp": 1706000000000
    }
  }
}
```

### Bundle Update Push

Sent to subscribed clients whenever a bundle transitions state:

```jsonc
{
  "event": "bundle_update",
  "data": {
    "action": "bundle_update",
    "timestamp": 1706000000000,
    "bundle": { /* full bundle response object */ }
  }
}
```

### Heartbeat

30 s ping/pong cycle. Clients that miss a pong are terminated.

## REST Endpoints

### `POST /v1.1/gasless/bundles/submit`

Creates a new bundle. The body is optional.

| Field | Type | Description |
|---|---|---|
| `referralCode` | `number \| string` | Optional. Stored as string. |
| `targetStatus` | `string` | Optional. One of: `fulfilled` (default), `partially_fulfilled`, `partially_fulfilled_expired`, `cancelled`, `expired`, `failed`. Controls how the bundle will progress. |

**Response:** `{ "bundleId": "0x..." }` (keccak256 hash, 66 chars)

### `GET /v1/gasless/bundles/:bundleId`

Returns a single bundle wrapped in the production response shape — a full object with `bundleId`, `status`, `trades`, `intents`, `preHooks`, `postHooks`, etc. from a static template. Dynamic fields: `bundleId`, `referralCode`, `status`, `createdAt`, `updatedAt`, `cancel`.

**404** if not found.

### `GET /v1/gasless/bundles`

Returns a paginated list of bundles.

| Query Param | Description |
|---|---|
| `referralCode` | Filter by referral code |
| `createdFrom` / `createdTo` | ISO 8601 date range on `created_at` |
| `updatedFrom` / `updatedTo` | ISO 8601 date range on `updated_at` |
| `sort` | One of: `createdAt`, `-createdAt` (default), `updatedAt`, `-updatedAt` |
| `page` | Page number (default 1) |
| `pageSize` | Items per page (default 10, max 100) |

**Response:**

```json
{
  "bundles": [ ... ],
  "total": 42,
  "page": 1,
  "pageSize": 10,
  "totalPages": 5
}
```

### `GET /health`

Returns `{ "status": "ok" }`.

## Database Schema

Single table `bundles` (from `src/db/migrations/001_initial.sql`):

| Column | Type | Default |
|---|---|---|
| `bundle_id` | `TEXT` | PRIMARY KEY |
| `status` | `TEXT NOT NULL` | `'created'` |
| `target_status` | `TEXT NOT NULL` | `'fulfilled'` |
| `referral_code` | `TEXT` | |
| `cancel` | `JSONB` | |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` |

Indexes: `status`, `created_at`, `updated_at`, `referral_code`.

## Configuration

All environment variables (see `.env.example`):

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `PORT` | No | `3000` | REST API port |
| `WS_PORT` | No | `3001` | WebSocket server port |
| `PROGRESSION_DELAY_MS` | No | `5000` | Minimum age (ms) before a bundle is eligible for its next state transition |
| `PROGRESSION_INTERVAL_MS` | No | `1000` | How often (ms) the progression worker polls for eligible bundles |
| `LOG_LEVEL` | No | `INFO` | Log level |
| `POSTGRES_USER` | No | `mockapi` | Docker Compose postgres user |
| `POSTGRES_PASSWORD` | No | `mockapi` | Docker Compose postgres password |
| `POSTGRES_DB` | No | `mockapi` | Docker Compose postgres database name |

## Quick Start

### Docker Compose (recommended)

```bash
cp .env.example .env
docker compose up --build
```

This starts Postgres (port 5433 on host) and the mock API (REST on 3000, WS on 3001). Migrations run automatically on startup.

### Dev mode (local Postgres required)

```bash
cp .env.example .env
# edit DATABASE_URL if your local Postgres differs
npm install
npm run dev          # tsx watch — auto-reloads on changes
```

### Other scripts

```bash
npm run build        # tsc
npm run start        # node dist/index.js (production build)
npm run migrate      # run migrations manually
npm run test         # smoke tests (server must be running)
```

## Smoke Tests

27 tests covering:

- Health check
- Bundle submission (with/without `referralCode`, `targetStatus`)
- GET single bundle (structure, 404)
- All 6 progression paths (1-step and 2-step)
- Deterministic batch verification (12 bundles with expected status distribution)
- Paginated list (pagination, sorting, filtering, pageSize cap)
- WebSocket subscribe/unsubscribe, `bundle_update` events, 2-step event emission, 100-ID limit, replace semantics

```bash
# Server must be running first
npm run test
# or with custom URLs:
MOCK_API_URL=http://localhost:3000 MOCK_WS_URL=ws://localhost:3001 npm run test
```

## How It Differs from Production

- **Static response template** — trades, intents, hooks, subtrades are hardcoded from a single real payload (`src/templates/bundle-response.ts`). Only `bundleId`, `status`, `referralCode`, `createdAt`, `updatedAt`, and `cancel` vary per bundle.
- **No authentication** — no API keys, no signatures verified.
- **No real blockchain interaction** — bundleIds are keccak256 hashes of random UUIDs, not derived from on-chain data.
- **Simplified state machine** — production has complex orchestration across chains; this mock uses a single `target_status` column and a timer-based worker.
- **Single-table storage** — no orders, subtrades, or separate intent tables.
- **`targetStatus` control parameter** — a mock-only field on submit that lets you predetermine the progression path. Not present in the production API.
- **No rate limiting or request validation** — the submit endpoint accepts any body shape.
