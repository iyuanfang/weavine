-- api_key: long-lived tokens for AI agent access (Codex CLI / OpenCode / Claude Desktop)
-- Per-user local; not synced to devices (no sync triggers).
CREATE TABLE IF NOT EXISTS api_key (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    user_id      TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    key_hash     TEXT NOT NULL,
    name         TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT now()::TEXT,
    last_used_at TEXT,
    revoked_at   TEXT
);

-- Plain (non-unique) index: one user may have multiple keys (one per device/agent).
CREATE INDEX IF NOT EXISTS api_key_user_id_idx ON api_key(user_id);
