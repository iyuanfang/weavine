-- 20260829000000_note_text_timestamps.sql
--
-- Schema alignment: rollback 20260825200000_note_text_to_timestamptz.sql.
-- note.created_at / updated_at revert from TIMESTAMPTZ back to TEXT to match
-- the AGENTS.md "sqlx-bound columns must be TEXT" convention used by every
-- other domain table (contact, project, event, action, setting, media).
--
-- The original TIMESTAMPTZ choice in 20260824000001_notes.sql was an
-- unintentional divergence; code in note.rs / search.rs / sync.rs has been
-- peppered with ad-hoc `::text` and `::timestamptz` casts to paper over it.
-- Storing as ISO-8601 UTC strings (the same format the desktop client uses
-- and that `normalize_lww_timestamp` already parses) lets us drop those casts.
--
-- Output format matches `handlers::now_str()` so lex sort = chronological
-- sort for cursor pagination in note.rs::list.

ALTER TABLE note ALTER COLUMN created_at TYPE TEXT
    USING to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
ALTER TABLE note ALTER COLUMN updated_at TYPE TEXT
    USING to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');