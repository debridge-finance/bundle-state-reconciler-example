# API Surface — bundle-state-sync/src

Every public export from the 14 source files, organised by module.
Workers import from these modules; standalone scripts (index, producer, checker, verify) are entry-points only and export nothing.

---

## types/index.ts

Re-exports everything from `./ws` (see [types/ws.ts](#typeswsts) below).

### Enums

| Export | Kind | Values |
|--------|------|--------|
| `BundleStatus` | `enum` | `created`, `partially_fulfilled`, `fulfilled`, `expired`, `cancelled`, `failed` |
| `TradeStatus` | `enum` | `created`, `partially_fulfilled`, `fulfilled`, `cancelled`, `failed`, `expired` |
| `TradingAlgorithm` | `enum` | `MARKET = "market"` |

### Constants

| Export | Type |
|--------|------|
| `TERMINAL_BUNDLE_STATUSES` | `BundleStatus[]` — `[fulfilled, expired, cancelled, failed]` |

### Query / Pagination Types

| Export | Kind | Key Fields |
|--------|------|------------|
| `GetBundlesFilterParams` | `type` | `intentOwner?`, `intentAuthority?`, `userId?`, `referralCode?`, `orderIds?`, `createdFrom?`, `createdTo?`, `updatedFrom?`, `updatedTo?`, `sort?`, `page?`, `pageSize?` |
| `PaginatedResponseMetadata` | `type` | `total`, `page`, `pageSize`, `totalPages` |
| `GetBundleListResponse` | `type` | Extends `PaginatedResponseMetadata` + `bundles: BundleResponse[]` |

### API Response Types

| Export | Kind | Key Fields |
|--------|------|------------|
| `BundleResponse` | `type` | `bundleId`, `status: BundleStatus`, `isAtomic`, `trades`, `intents`, `executedSrc/Dst`, `finalizedSrc/Dst`, `createdAt`, `referralCode?`, `tradingAlgorithm?`, `preHooks?`, `postHooks?`, `cancel?`, `userId?`, `updatedAt?` |
| `BundleTradeResponse` | `type` | `id`, `intentId`, `tokenIn`, `tokenOut`, `receiverAddress`, `status: TradeStatus`, `executedSrc/Dst`, `finalizedSrc/Dst`, `subtrades`, `tradeId?`, `externalCall?` |
| `IntentWithActionsResponse` | `type` | `intentId`, `requiredActions: ActionResponse[]`, `intent` |
| `ActionResponse` | `type` | `type: number`, `actions: number[]`, `signedData`, `data?`, `gasPayment?`, `actionId?` |
| `HookResponse` | `type` | `isAtomic`, `data`, `to`, `value`, `chainId`, `requiredActions`, `tokenAddress`, `from`, `executedSrc/Dst`, `finalizedSrc/Dst` |
| `SubtradeResponse` | `type` | `id`, `status: TradeStatus`, `tokenInAmount`, `tokenOutAmount`, `tokenOutMinAmount`, `createdAt`, `orderId?`, `transactionHash?` |
| `TradeTokenIn` | `type` | `chainId`, `address`, `amount`, `isWrapped?` |
| `TradeTokenOut` | `type` | `chainId`, `address`, `amount`, `minAmount` |
| `ExternalCallResponse` | `type` | `executionFee`, `fallbackAddressDst`, `data` |
| `GasPaymentResponse` | `type` | `type?`, `basicDetails?`, `takenUserTokens?` |
| `GasPaymentBasicDetails` | `type` | `nativeTokenAmount`, `approximateUsdEquivalent` |
| `TakenUserTokens` | `type` | `tokenAddress`, `tokenAmount` |
| `CancelBundleData` | `type` | `preImage`, `signature`, `authority`, `createdAt`, `reason?` |

---

## types/db.ts

| Export | Kind | Description |
|--------|------|-------------|
| `ApiBundleResponse` | `type` | Alias for `BundleResponse` |
| `BundleRow` | `type` | DB row shape: `bundle_id`, `status`, `has_cancellation`, `raw_payload`, `check_count`, `requires_manual_review`, `flagged_at`, `last_checked_at`, `first_seen_source`, `created_at`, `updated_at`, `synced_at` |
| `Stats` | `type` | `{ byStatus: Record<string,number>, flagged: number, inFlight: number, total: number }` |

---

## types/ws.ts

Also available via `types/index.ts` re-export.

### Enums

| Export | Kind | Values |
|--------|------|--------|
| `WsFilterKey` | `enum` | `bundleId`, `referralCode`, `intentOwner`, `intentAuthority`, `cancelPartnerAuthority`, `userId` |
| `ClientEvent` | `enum` | `subscribe`, `unsubscribe` |
| `ServerEvent` | `enum` | `subscribe`, `bundle_update`, `unsubscribed`, `error` |

### Filter Types

| Export | Kind | Description |
|--------|------|-------------|
| `WsFilterMap` | `type` | `{ bundleId?: string[], referralCode?: string[], intentOwner?: string[], intentAuthority?: string[], cancelPartnerAuthority?: string[], userId?: string[] }` |
| `WsFilterWrapper` | `type` | `{ filters: WsFilterMap }` |
| `BuiltFilters` | `type` | `WsFilterWrapper[]` |

### Client → Server Messages

| Export | Kind | Description |
|--------|------|-------------|
| `ClientEnvelope<TEvent, TData>` | `interface` | `{ event: TEvent, data: TData }` |
| `SubscribeMessage` | `type` | `ClientEnvelope<ClientEvent.subscribe, WsFilterWrapper>` |
| `UnsubscribeMessage` | `type` | `ClientEnvelope<ClientEvent.unsubscribe, WsFilterWrapper>` |
| `ClientMessage` | `type` | `SubscribeMessage \| UnsubscribeMessage` |

### Server → Client Messages

| Export | Kind | Description |
|--------|------|-------------|
| `ServerEnvelope<TEvent, TData>` | `interface` | `{ event: TEvent, data: TData }` |
| `SubscribeAckData` | `interface` | `{ filters?: WsFilterMap, subscriptionId?: string }` |
| `UnsubscribedData` | `interface` | `{ filters?: WsFilterMap, subscriptionId?: string }` |
| `ServerErrorData` | `interface` | `{ code?: string \| number, message: string, details?: unknown }` |
| `SubscribeAckMessage` | `type` | `ServerEnvelope<ServerEvent.subscribe, SubscribeAckData>` |
| `BundleUpdateMessage` | `type` | `ServerEnvelope<ServerEvent.bundle_update, BundleResponse>` |
| `UnsubscribedMessage` | `type` | `ServerEnvelope<ServerEvent.unsubscribed, UnsubscribedData>` |
| `ServerErrorMessage` | `type` | `ServerEnvelope<ServerEvent.error, ServerErrorData>` |
| `ServerMessage` | `type` | Union of all four server message types |

### WS Config & Subscription Management

| Export | Kind | Description |
|--------|------|-------------|
| `WSConfig` | `type` | `{ url, filters: WsFilterMap, reconnect?: { enabled, baseMs, maxMs } }` |
| `WSClientConfig` | `type` | Extends `WSConfig` + `onBundleUpdate`, `onError?`, `onOpen?`, `onClose?`, `pingIntervalMs?`, `maxSubscriptionsPerConnection?` |
| `SubscriptionManagerStats` | `interface` | `{ activeSubscriptions, totalConnections, bundleIdsTracked }` |
| `SubscriptionManager` | `interface` | Methods: `subscribe(ids)`, `unsubscribe(ids)`, `subscribeBatch(ids)`, `pruneTerminal(ids)`, `getStats()`, `close()` |

### Functions

| Export | Signature | Description |
|--------|-----------|-------------|
| `buildFilters` | `(map: WsFilterMap) => BuiltFilters` | Wraps a filter map into the array shape expected by subscribe |
| `isServerEnvelope` | `(x: unknown) => x is ServerMessage` | Type guard for any server message |
| `isBundleUpdate` | `(m: ServerMessage) => m is BundleUpdateMessage` | Narrows to bundle_update event |
| `isServerError` | `(m: ServerMessage) => m is ServerErrorMessage` | Narrows to error event |

---

## services/bundle-store.ts

All functions take `pg.Pool` as first argument.

| Export | Signature | Description |
|--------|-----------|-------------|
| `UpsertResult` | `type` | `"inserted" \| "updated" \| "skipped"` |
| `upsertBundle` | `(pool, bundle: ApiBundleResponse, source: string) => Promise<UpsertResult>` | Insert or update a bundle; skips if incoming `updatedAt` is older; clears flags on terminal status |
| `getPendingBundles` | `(pool, limit?: number, minAgeMinutes?: number) => Promise<{ bundle_id, raw_payload, check_count }[]>` | Non-terminal, non-cancelled, non-flagged bundles respecting exponential backoff (60s → 120s → 240s → 480s → 900s) |
| `markChecked` | `(pool, bundleId: string) => Promise<number>` | Increment `check_count`, set `last_checked_at = NOW()`; returns rows affected |
| `flagForManualReview` | `(pool, bundleId: string) => Promise<number>` | Set `requires_manual_review = TRUE`; returns rows affected |
| `unflagBundle` | `(pool, bundleId: string) => Promise<number>` | Clear flag, reset `check_count` and `last_checked_at`; returns rows affected |
| `getFlaggedBundles` | `(pool, limit?: number, offset?: number) => Promise<{ bundle_id, raw_payload, flagged_at }[]>` | Flagged bundles ordered by `flagged_at DESC` |
| `getWatermark` | `(pool, key: string) => Promise<string \| null>` | Read a named watermark from `sync_state` |
| `setWatermark` | `(pool, key: string, value: string) => Promise<void>` | Upsert a named watermark in `sync_state` |
| `getStats` | `(pool) => Promise<Stats>` | Aggregate counts by status, flagged, in-flight, total |
| `getNonTerminalBundleIds` | `(pool) => Promise<string[]>` | All bundle IDs not in a terminal status, ordered by `created_at DESC` |
| `getBundleStatuses` | `(pool, bundleIds: string[]) => Promise<Map<string, string>>` | Batch lookup of `bundle_id → status` |

---

## services/debridge-api.ts

| Export | Signature | Description |
|--------|-----------|-------------|
| `DebridgeApiOptions` | `interface` | `{ baseUrl: string, apiKey: string }` |
| `fetchBundles` | `(options: DebridgeApiOptions, filters: GetBundlesFilterParams) => Promise<GetBundleListResponse>` | `GET /v1/gasless/bundles` with query params from filters |
| `fetchBundleById` | `(options: DebridgeApiOptions, bundleId: string) => Promise<BundleResponse \| null>` | `GET /v1/gasless/bundles/:id`; returns `null` on 404 |

---

## services/rate-limiter.ts

| Export | Kind | Description |
|--------|------|-------------|
| `RateLimiter` | `interface` | `acquire(): Promise<void>`, `getUsage(): { used, remaining }`, `reset(): void` |
| `RateLimiterOptions` | `interface` | `{ maxRequestsPerMinute: number, name?: string }` |
| `createRateLimiter` | `(options: RateLimiterOptions) => RateLimiter` | Sliding-window rate limiter; `acquire()` blocks when window is full |

---

## db/client.ts

| Export | Signature | Description |
|--------|-----------|-------------|
| `getPool` | `(databaseUrl: string) => pg.Pool` | Lazy singleton; creates pool on first call |
| `connectDb` | `(databaseUrl: string) => Promise<void>` | Calls `getPool` + verifies with `SELECT NOW()` |
| `disconnectDb` | `() => Promise<void>` | Ends pool, resets singleton to `null` |

---

## db/migrate.ts

| Export | Signature | Description |
|--------|-----------|-------------|
| `runMigrations` | `(pool: pg.Pool) => Promise<void>` | Applies `.sql` files from `db/migrations/` via `_migrations` tracking table |

Also runs standalone when invoked as `require.main`.

---

## utils/logger.ts

| Export | Kind | Description |
|--------|------|-------------|
| `logger` | `const` object | `{ debug, info, warn, error }` — level-filtered console logger; reads `LOG_LEVEL` env var (`DEBUG`, `INFO`, `WARN`, `ERROR`) |

---

## config.ts

| Export | Kind | Description |
|--------|------|-------------|
| `Config` | `interface` | `databaseUrl`, `mockApiDatabaseUrl`, `debridgeApiUrl`, `debridgeWsUrl`, `debridgeApiKey`, `referralCode`, `worker2PollIntervalMs`, `worker3PollIntervalMs`, `worker2OverlapBufferSeconds`, `worker3MaxCheckCount`, `worker3MinBundleAgeMinutes`, `rateLimitTotalRpm`, `rateLimitWorker2Rpm`, `rateLimitWorker3Rpm`, `wsMaxSubsPerConnection`, `wsReconnectBaseMs`, `wsReconnectMaxMs`, `logLevel` |
| `loadConfig` | `() => Config` | Reads from env vars; `DATABASE_URL`, `DEBRIDGE_API_KEY`, `REFERRAL_CODE` are required; rest have defaults |
| `ProducerConfig` | `interface` | `databaseUrl`, `mockApiUrl`, `referralCode`, `totalBundles`, `rps`, `distribution` |
| `loadProducerConfig` | `() => ProducerConfig` | Reads from env vars; all optional with sensible defaults |

---

## Entry-Point Scripts (no importable exports)

| File | Purpose |
|------|---------|
| `index.ts` | Connects DB, runs migrations, prints stats, waits for `SIGINT`/`SIGTERM` |
| `producer.ts` | Seeds bundles via mock API + upserts into local DB; writes `data/producer-manifest.json` |
| `checker.ts` | Compares mock API DB vs sync DB vs manifest; writes `data/verification-report.json` |
| `db/verify.ts` | Integration test suite for bundle-store, rate-limiter, and API client types |
