-- spec: Weavine-产品需求Spec.md §3.5.2 + §3.5.6
-- Idempotent: safe to run on a fresh DB, on a DB that already has
-- last_interaction_at / invitation_token, or on a DB that still has stale
-- reminder rows from pre-Phase-2.6 (kind='event' → map to 'time').
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'contact' AND column_name = 'last_contacted_at'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'contact' AND column_name = 'last_interaction_at'
    ) THEN
        ALTER TABLE contact RENAME COLUMN last_contacted_at TO last_interaction_at;
    END IF;
END $$;

-- Phase 2.6 reminders carry kind='time' (one-shot trigger) or 'cadence' (recurring).
-- Older Phase 2.5 reminders defaulted to 'event' — coalesce those to 'time' so the
-- new CHECK constraint can be applied. The Phase 2.5 row is functionally a one-shot
-- reminder tied to an event, which is exactly what 'time' represents.
UPDATE reminder SET kind = 'time' WHERE kind NOT IN ('time', 'cadence');

ALTER TABLE reminder ADD COLUMN IF NOT EXISTS invitation_token TEXT;
ALTER TABLE reminder DROP CONSTRAINT IF EXISTS reminder_kind_check;
ALTER TABLE reminder ADD CONSTRAINT reminder_kind_check
    CHECK (kind IN ('time', 'cadence'));
CREATE INDEX IF NOT EXISTS idx_reminder_invitation_token
    ON reminder(invitation_token) WHERE invitation_token IS NOT NULL;