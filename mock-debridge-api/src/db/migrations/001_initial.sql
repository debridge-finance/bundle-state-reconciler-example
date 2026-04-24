CREATE TABLE IF NOT EXISTS bundles (
    bundle_id      TEXT PRIMARY KEY,
    status         TEXT NOT NULL DEFAULT 'created',
    target_status  TEXT NOT NULL DEFAULT 'fulfilled',
    referral_code  TEXT,
    cancel         JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mock_bundles_status ON bundles(status);
CREATE INDEX IF NOT EXISTS idx_mock_bundles_created_at ON bundles(created_at);
CREATE INDEX IF NOT EXISTS idx_mock_bundles_updated_at ON bundles(updated_at);
CREATE INDEX IF NOT EXISTS idx_mock_bundles_referral ON bundles(referral_code);
