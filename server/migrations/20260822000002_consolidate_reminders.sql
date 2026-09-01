-- Migration 20260822000002: consolidate reminders onto keep_in_touch
--
-- (1) Add `keep_in_touch_cadence_days` to the cloud contact table so the
--     desktop-app override can sync. NULL = use importance-derived default
--     (high=30, medium=90, low=180) in keep_in_touch_server.
--
-- (2) Delete existing `kind='cadence'` rows. Their `trigger_at` was set
--     to scheduler-run time (not last_interaction + cadence), so keeping
--     them under the renamed kind would make every contact look "due
--     now" on first deploy. The new scheduler will create fresh rows
--     with correct `trigger_at = last_interaction + cadence`.

ALTER TABLE contact
    ADD COLUMN IF NOT EXISTS keep_in_touch_cadence_days BIGINT;

DELETE FROM reminder WHERE kind = 'cadence';