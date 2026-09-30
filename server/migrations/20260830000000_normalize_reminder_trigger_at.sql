-- 20260830000000_normalize_reminder_trigger_at.sql
--
-- Normalize reminder.trigger_at to the canonical Z-form (ms precision) used by
-- every writer after this round of refactors. Older rows written by event.rs
-- prior to 2026-08-30 used `to_rfc3339()` which emits `+00:00` + nanosecond
-- precision, while keep_in_touch_server.rs used `Z` + ms precision. Mixed
-- formats in one TEXT column broke the assumption that lex sort == chronological
-- sort, since `"2026-08-29T12:00:00.000Z"` and `"2026-08-29T12:00:00+00:00"`
-- sort differently while representing the same instant.
--
-- Idempotent: re-running just rewrites to the same canonical form. Empty /
-- NULL rows are skipped (no implicit cast possible on empty string anyway).
--
-- Both `+00:00` and `Z` parse cleanly into TIMESTAMPTZ via `::timestamptz`,
-- then we reformat with `to_char(... AT TIME ZONE 'UTC', ...)` using the
-- same YYYY-MM-DD"T"HH24:MI:SS.MS"Z" pattern that handlers::now_str() and
-- the media/note timestamp migrations use.

UPDATE reminder
SET trigger_at = to_char(trigger_at::timestamptz AT TIME ZONE 'UTC',
                          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE trigger_at IS NOT NULL AND trigger_at <> '';