-- 20260825200000_note_text_to_timestamptz.sql
--
-- Schema alignment: 20260824000001_notes.sql declared note.created_at/updated_at
-- as TIMESTAMPTZ but used CREATE TABLE IF NOT EXISTS, which is a no-op when
-- the table already exists (local dev seeded during notes design phase). Prod
-- was fresh and correctly has TIMESTAMPTZ; local was left as TEXT. Existing
-- TEXT values are ISO 8601 (e.g. "2026-08-24T18:06:52.753Z") so the
-- ::timestamptz cast parses cleanly.

ALTER TABLE note ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
ALTER TABLE note ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::timestamptz;