# bundle-state-sync

Maintains a local PostgreSQL mirror of deBridge gasless bundle states. Three workers provide layered coverage: a **WebSocket worker** for real-time push updates, a **Poller** for time-windowed REST backfill, and a **Reconciler** that re-checks stale non-terminal bundles with exponential backoff.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   bundle-state-sync                     │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Worker 1 │  │ Worker 2 │  │ Worker 3 │              │
│  │ WS live  │  │ REST     │  │ REST     │              │
│  │ updates  │  │ backfill │  │ poll     │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │              │             │                    │
│       │         ┌────┴─────────────┴────┐               │
│       │         │     Rate Limiter      │               │
│       │         │  (sliding window/min) │               │
│       │         └────┬─────────────┬────┘               │
│       │              │             │                    │
│       │         ┌────┴─────────────┴────┐               │
│       │         │    deBridge API Client │               │
│       │         │  GET /v1/gasless/...   │               │
│       │         └───────────────────────┘               │
│       │                                                 │
│  ┌────┴────────────────────────────────────┐            │
│  │            Bundle Store (pg)            │            │
│  │  upsert · pending · watermark · stats   │            │
│  └────┬────────────────────────────────────┘            │
│       │                                                 │
└───────┼─────────────────────────────────────────────────┘
        │
   ┌────┴────┐
   │ Postgres │
   └─────────┘
```

**Data flow:** Worker 1 receives bundle updates over WebSocket and writes directly to Postgres (no REST API calls). Workers 2 and 3 share a rate-limited REST API client — the Poller fetches pages of bundles by time window, while the Reconciler fetches individual bundles by ID. All three workers converge on the same `upsertBundle()` function, which uses an `updatedAt` guard to ensure only newer data wins.

## Workers

### Worker 1 — WebSocket (`src/workers/websocket-worker.ts`)

Real-time push. Subscribes to bundle updates by `bundleId` filter.

- **Startup**: loads all non-terminal bundle IDs via `getNonTerminalBundleIds()` and bulk-subscribes via `subscribeBatch()`
- **Instant subscription via LISTEN/NOTIFY**: listens on a dedicated Postgres connection for `new_bundle` notifications. When any code path inserts a bundle (injector, poller, reconciler), Postgres delivers the bundleId to Worker 1 in milliseconds, triggering an immediate WebSocket subscribe. The 30-second sync cycle remains as a fallback.
- **Connection sharding**: max 100 subscriptions per WebSocket connection (`WS_MAX_SUBS_PER_CONNECTION`). New connections are created automatically when capacity is exhausted.
- **Subscribe semantics**: replace — the full ID set is re-sent to the server on each subscribe call per connection
- **Periodic sync** (every 30s): subscribes any new non-terminal IDs that appeared in the DB, prunes terminal ones
- **Heartbeat**: pings every 25s; terminates unresponsive connections
- **Reconnect**: exponential backoff from 500ms base to 30s ceiling (`WS_RECONNECT_BASE_MS` / `WS_RECONNECT_MAX_MS`). Replays all subscriptions from the disconnected connection.
- **Envelope normalization**: handles both `parsed.data.bundle` and `parsed.data` shapes
- **Auto-unsubscribe**: removes a bundle from the subscription pool when it reaches a terminal status (`fulfilled`, `expired`, `cancelled`, `failed`)

### Worker 2 — Poller (`src/workers/poller-worker.ts`)

Sliding time-window backfill via REST API.

- **Poll interval**: every 15s (`WORKER2_POLL_INTERVAL_MS`), 1s initial delay
- **Watermark-based**: reads `worker2_last_synced_at` from `sync_state`, subtracts a 10s overlap buffer (`WORKER2_OVERLAP_BUFFER_SECONDS`)
- **First run**: defaults to 5 minutes ago when no watermark exists
- **Pagination**: 100 bundles per page, iterates all pages
- **Rate limited**: 200 RPM (`RATE_LIMIT_WORKER2_RPM`)

### Worker 3 — Reconciler (`src/workers/reconciler-worker.ts`)

Stale-bundle refresh via per-ID REST API lookups.

- **Poll interval**: every 60s (`WORKER3_POLL_INTERVAL_MS`), 3s initial delay
- **Batch size**: up to 500 pending bundles per cycle, only those older than 5 minutes (`WORKER3_MIN_BUNDLE_AGE_MINUTES`)
- **Per-bundle**: fetches fresh state via `fetchBundleById()`, upserts into DB, increments `check_count`
- **Exponential backoff** (re-check interval per bundle, from `getPendingBundles` CASE):

  | `check_count` | Min interval before next check |
  |----------------|-------------------------------|
  | 0              | 60 seconds                    |
  | 1              | 120 seconds                   |
  | 2              | 240 seconds                   |
  | 3              | 480 seconds                   |
  | 4+             | 900 seconds                   |

- **Manual review**: after 15 checks (`WORKER3_MAX_CHECK_COUNT`), flags the bundle (`requires_manual_review = TRUE`)
- **Rate limited**: 100 RPM (`RATE_LIMIT_WORKER3_RPM`)

## Database Schema

From `src/db/migrations/001_initial.sql`.

### `bundles` table

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `bundle_id` | `TEXT` | — | Primary key |
| `status` | `TEXT` | `'created'` | Current bundle status |
| `has_cancellation` | `BOOLEAN` | `FALSE` | Whether cancel data is present |
| `raw_payload` | `JSONB` | — | Full API response payload |
| `check_count` | `INTEGER` | `0` | Times reconciler has re-checked this bundle |
| `requires_manual_review` | `BOOLEAN` | `FALSE` | Flagged by reconciler after max checks |
| `flagged_at` | `TIMESTAMPTZ` | `NULL` | When manual review was flagged |
| `last_checked_at` | `TIMESTAMPTZ` | `NULL` | Last reconciler check time |
| `first_seen_source` | `TEXT` | `NULL` | Which worker first saw this bundle (`websocket`, `poller`, `reconciler`, `injected`, `producer`) |
| `created_at` | `TIMESTAMPTZ` | `NULL` | Bundle creation time from API |
| `updated_at` | `TIMESTAMPTZ` | `NULL` | Bundle update time from API |
| `synced_at` | `TIMESTAMPTZ` | `NOW()` | When this row was last synced |

**Indexes:**
- `idx_bundles_status` — on `status`
- `idx_bundles_updated_at` — on `updated_at`
- `idx_bundles_pending` — partial index on `(last_checked_at NULLS FIRST)` WHERE status is non-terminal, not flagged, no cancellation. Used by reconciler.
- `idx_bundles_flagged` — partial index on `(flagged_at DESC)` WHERE `requires_manual_review = TRUE`

**Upsert behavior:**
- `ON CONFLICT (bundle_id) DO UPDATE` with guard: `WHERE bundles.updated_at IS NULL OR bundles.updated_at < EXCLUDED.updated_at` — ensures only newer data overwrites
- When a bundle reaches terminal status: `check_count` resets to 0, `requires_manual_review` clears to FALSE, `flagged_at` clears to NULL
- When status changes (non-terminal → different status): `check_count` resets to 0

### `sync_state` table

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `key` | `TEXT` | — | Primary key (e.g. `worker2_last_synced_at`) |
| `value` | `TEXT` | — | Watermark value |
| `updated_at` | `TIMESTAMPTZ` | `NOW()` | Last update time |

## Configuration

All environment variables with defaults from `src/config.ts`.

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Postgres connection string |
| `DEBRIDGE_API_KEY` | deBridge partner API key |
| `REFERRAL_CODE` | deBridge referral code |

### Worker Config

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKER2_POLL_INTERVAL_MS` | `15000` | Poller interval |
| `WORKER3_POLL_INTERVAL_MS` | `60000` | Reconciler interval |
| `WORKER2_OVERLAP_BUFFER_SECONDS` | `10` | Overlap subtracted from poller watermark |
| `WORKER3_MAX_CHECK_COUNT` | `15` | Max re-checks before flagging for manual review |
| `WORKER3_MIN_BUNDLE_AGE_MINUTES` | `5` | Skip bundles newer than this in reconciler |

### Rate Limits

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_TOTAL_RPM` | `300` | Hard cap across all workers |
| `RATE_LIMIT_WORKER2_RPM` | `200` | Poller API requests per minute |
| `RATE_LIMIT_WORKER3_RPM` | `100` | Reconciler API requests per minute |

### WebSocket

| Variable | Default | Description |
|----------|---------|-------------|
| `WS_MAX_SUBS_PER_CONNECTION` | `100` | Max subscriptions per WS connection |
| `WS_RECONNECT_BASE_MS` | `500` | Base reconnect delay |
| `WS_RECONNECT_MAX_MS` | `30000` | Max reconnect delay (ceiling) |

### API & Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `DEBRIDGE_API_URL` | `https://api-gaslessb2b.debridge.finance` | REST API base URL |
| `DEBRIDGE_WS_URL` | `wss://api-gaslessb2b.debridge.finance/ws` | WebSocket URL |
| `MOCK_API_DATABASE_URL` | `postgresql://mockapi:mockapi@localhost:5433/mockapi` | Mock API Postgres (for checker) |
| `LOG_LEVEL` | `INFO` | Log level (`DEBUG`, `INFO`, `WARN`, `ERROR`) |

## Quick Start (Docker)

```bash
cp .env.example .env
# Edit .env — set DEBRIDGE_API_KEY and REFERRAL_CODE

docker compose up --build
```

Postgres starts first (with healthcheck). Once healthy, the sync service connects and logs **"bundle-state-sync is ready."**

To stop gracefully:

```bash
docker compose down
```

## Running Against Production

Set these environment variables to point at the real deBridge API:

```bash
DEBRIDGE_API_URL=https://api-gaslessb2b.debridge.finance
DEBRIDGE_WS_URL=wss://api-gaslessb2b.debridge.finance/ws
DEBRIDGE_API_KEY=<your-production-api-key>
```

These are already the defaults for the API URLs, so you only need to provide a valid `DEBRIDGE_API_KEY` and `REFERRAL_CODE`.

## Local Development with Mock API

For end-to-end testing without hitting the production API, use the mock API server from `test-mock-debridge-api/`:

1. Start both Postgres instances and the mock API:
   ```bash
   # From test-mock-debridge-api/
   docker compose up -d
   ```

2. Point bundle-state-sync at the mock:
   ```bash
   DEBRIDGE_API_URL=http://localhost:3000
   DEBRIDGE_WS_URL=ws://localhost:3000/ws
   ```

3. Seed test data with the producer, run the sync service, then verify:
   ```bash
   npm run producer     # seed bundles into mock API
   npm run dev          # start sync workers
   npm run checker      # 3-way comparison
   ```

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `build` | `npm run build` | Compile TypeScript to `dist/` |
| `start` | `npm start` | Run compiled service |
| `dev` | `npm run dev` | Run with tsx watch (auto-reload) |
| `migrate` | `npm run migrate` | Run database migrations |
| `verify` | `npm run verify` | Run integration tests (18 tests covering upsert, backoff, watermarks, rate limiting) |
| `producer` | `npm run producer` | Seed bundles into mock API with target status distribution |
| `checker` | `npm run checker` | 3-way verification: manifest vs mock API DB vs sync DB |

## Tools

### inject-bundle (`src/inject-bundle.ts`)

Importable module for injecting bundle IDs into the sync database from external scripts (e.g. submit scripts in `src/gasless-intents/`).

```typescript
import { injectBundle, injectBundles, closeInjector } from '../../bundle-state-sync/src/inject-bundle';

const response = await submitBundle(payload);
await injectBundle(response.bundleId);  // returns 'injected' | 'exists'
await closeInjector();                  // closes the pg pool
```

Inserts a stub row with `status = 'created'`, `first_seen_source = 'injected'`, and empty `raw_payload`. Fires a Postgres `NOTIFY` that Worker 1 receives instantly, triggering an immediate WebSocket subscription — no need to wait for the 30-second sync cycle.

### Producer (`src/producer.ts`)

Submits bundles to the mock API with a configurable target status distribution. Each bundle is also seeded into the sync DB with `'created'` status.

- Default: 100 bundles at 10 RPS
- Default distribution: `fulfilled:50, partially_fulfilled:15, partially_fulfilled_expired:5, cancelled:10, expired:10, failed:10`
- Writes manifest to `data/producer-manifest.json`

Configure via env vars: `PRODUCER_TOTAL_BUNDLES`, `PRODUCER_RPS`, `PRODUCER_DISTRIBUTION` (format: `"fulfilled:50,cancelled:10,..."`)

### Checker (`src/checker.ts`)

Reads the producer manifest and performs a 3-way comparison:

1. **Mock API DB vs Manifest** — did the mock API's state machine advance bundles to expected final statuses?
2. **Sync DB vs Manifest** — did bundle-state-sync capture the correct final statuses?
3. **Mock API DB vs Sync DB** — do the two databases agree?

Reports: `pass`, `fail`, `in_progress`, or `workers_not_run`. Writes detailed report to `data/verification-report.json`.

## Key Design Decisions

- **Three workers for layered coverage**: WebSocket (push) catches updates in real time, Poller (pull) backfills any missed bundles by time window, Reconciler refreshes stale bundles individually. Any single worker failing does not cause data loss.
- **Upsert with `updatedAt` guard**: all three workers can write concurrently without overwriting newer data. Idempotent by design.
- **Replace subscribe semantics**: each WebSocket subscribe call sends the full set of IDs for that connection. Simpler than incremental add/remove — the server clears existing subs before applying.
- **Exponential backoff on reconciler**: avoids hammering unchanged bundles. Check intervals grow from 60s to 15 minutes. After 15 checks, the bundle is flagged for manual review instead of consuming more API budget.
- **Rate limit budget split**: 200 RPM for the poller (bulk pages) + 100 RPM for the reconciler (per-bundle lookups), under a 300 RPM total cap. WebSocket does not consume REST API quota.
- **Postgres LISTEN/NOTIFY for instant subscription**: When a bundle is inserted (by injector, poller, or reconciler), Postgres notifies Worker 1 immediately. This avoids the 30-second sync delay for real-time tracking. Uses a dedicated `pg.Client` connection (not from the pool) since `LISTEN` requires a persistent connection. This is an application-level approach — the `pg_notify()` calls live in `injectBundle()` and `upsertBundle()`, not in a database trigger. Direct SQL inserts that bypass these functions will not fire notifications; the 30-second sync cycle covers those as a fallback.

## Prerequisites

- Node.js 20+
- Docker & Docker Compose
- A deBridge API key and referral code
