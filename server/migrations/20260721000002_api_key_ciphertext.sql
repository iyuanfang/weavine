ALTER TABLE api_key
    ADD COLUMN IF NOT EXISTS key_ciphertext BYTEA,
    ADD COLUMN IF NOT EXISTS key_nonce BYTEA,
    ADD COLUMN IF NOT EXISTS key_prefix TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS key_last4 TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS api_key_user_active_idx
    ON api_key (user_id, created_at DESC)
    WHERE revoked_at IS NULL;
