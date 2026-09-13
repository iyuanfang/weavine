-- Migration 0005: track last auto-archive sweep per user (lazy hook)
-- Nullable so existing rows don't need a backfill; lazy sweep backfills
-- on first archive-related request after migration runs.

ALTER TABLE user_account ADD COLUMN last_archive_sweep_at TEXT;
