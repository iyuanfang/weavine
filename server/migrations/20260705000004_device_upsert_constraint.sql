-- Migration 0004: Add unique constraint on devices (user_id, name, os) for login UPSERT
-- Also add a partial unique index on refresh_token to support at most one active session per device

ALTER TABLE devices ADD UNIQUE (user_id, name, os);
