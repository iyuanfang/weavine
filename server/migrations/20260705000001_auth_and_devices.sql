-- Migration 0001: Rebuild user_account with UUID PK, add devices table, add FK to refresh_token
-- Drops old TEXT-PK tables and recreates with proper UUID types.

DROP TABLE IF EXISTS refresh_token;
DROP TABLE IF EXISTS user_account CASCADE;

CREATE TABLE user_account (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE devices (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    os            TEXT NOT NULL,
    app_version   TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    revoked_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_devices_user_revoked ON devices(user_id, revoked_at);

CREATE TABLE refresh_token (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    token_hash  TEXT UNIQUE NOT NULL,
    expires_at  TEXT NOT NULL,
    revoked_at  TEXT,
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refresh_token_user ON refresh_token(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_token_device ON refresh_token(device_id);
