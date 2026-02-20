-- 001_initial.sql — bundles + sync_state tables

CREATE TABLE IF NOT EXISTS bundles (
  bundle_id            TEXT PRIMARY KEY,
  status               TEXT NOT NULL DEFAULT 'created',
  has_cancellation     BOOLEAN NOT NULL DEFAULT FALSE,
  raw_payload          JSONB NOT NULL,
  check_count          INTEGER NOT NULL DEFAULT 0,
  requires_manual_review BOOLEAN NOT NULL DEFAULT FALSE,
  flagged_at           TIMESTAMPTZ,
  last_checked_at      TIMESTAMPTZ,
  first_seen_source    TEXT,
  created_at           TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bundles_status ON bundles (status);
CREATE INDEX IF NOT EXISTS idx_bundles_updated_at ON bundles (updated_at);
CREATE INDEX IF NOT EXISTS idx_bundles_pending
  ON bundles (last_checked_at NULLS FIRST)
  WHERE status NOT IN ('fulfilled', 'expired', 'cancelled', 'failed')
    AND requires_manual_review = FALSE
    AND has_cancellation = FALSE;
CREATE INDEX IF NOT EXISTS idx_bundles_flagged
  ON bundles (flagged_at DESC)
  WHERE requires_manual_review = TRUE;
