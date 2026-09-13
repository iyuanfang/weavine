-- Migration 20260822000004: last_interaction_at NOT NULL
--
-- Contact.last_interaction_at was nullable historically. Per the new
-- design, every contact must have a last_interaction_at (it gets stamped
-- to the same value as created_at on insert, so the keep-in-touch timer
-- starts immediately).
--
-- This migration backfills NULL rows with created_at (or now() as a
-- final fallback) and then adds the NOT NULL constraint. Postgres
-- supports ALTER COLUMN ... SET NOT NULL.

UPDATE contact
   SET last_interaction_at = COALESCE(created_at::timestamptz, now())
 WHERE last_interaction_at IS NULL;

ALTER TABLE contact
    ALTER COLUMN last_interaction_at SET NOT NULL;