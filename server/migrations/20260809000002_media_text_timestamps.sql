-- AGENTS.md: sqlx-bound columns must be TEXT. 20260807000002 declared
-- media.created_at / updated_at as TIMESTAMPTZ, which the shared Media
-- struct (Option<String>) cannot decode — upload returned 500. Convert
-- to TEXT and reformat existing rows as ISO-8601 UTC.

ALTER TABLE media
    ALTER COLUMN created_at TYPE TEXT USING to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    ALTER COLUMN updated_at TYPE TEXT USING to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');