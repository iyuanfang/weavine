-- Password reset tokens. Single-use, time-limited, never synced to clients.
-- The plaintext token is returned to the user via email once; only the
-- blake3 hash is persisted. Same posture as `refresh_token`.

CREATE TABLE IF NOT EXISTS password_reset_token (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    user_id    TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    used_at    TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_reset_token_user ON password_reset_token(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_token_expires ON password_reset_token(expires_at);
