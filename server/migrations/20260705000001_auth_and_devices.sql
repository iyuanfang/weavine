-- Migration 0001: Add devices table; rebuild refresh_token to add device_id FK. Additive (no destructive drops).

-- Add name column to user_account if absent (initial schema may have it already)
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS name TEXT;

-- devices table (new)
CREATE TABLE IF NOT EXISTS devices (
    id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    user_id       TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    os            TEXT NOT NULL,
    app_version   TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    revoked_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_devices_user_revoked ON devices(user_id, revoked_at);

-- refresh_token: rebuild to add device_id FK
DROP TABLE IF EXISTS refresh_token;
CREATE TABLE refresh_token (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    user_id     TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    token_hash  TEXT UNIQUE NOT NULL,
    expires_at  TEXT NOT NULL,
    revoked_at  TEXT,
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refresh_token_user ON refresh_token(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_token_device ON refresh_token(device_id);
CREATE INDEX IF NOT EXISTS idx_refresh_token_token_hash ON refresh_token(token_hash);
