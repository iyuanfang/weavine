-- spec: Weavine-产品需求Spec.md §3.5.2 + §3.5.6
ALTER TABLE contact RENAME COLUMN last_contacted_at TO last_interaction_at;
ALTER TABLE reminder ADD COLUMN IF NOT EXISTS invitation_token TEXT;
ALTER TABLE reminder DROP CONSTRAINT IF EXISTS reminder_kind_check;
ALTER TABLE reminder ADD CONSTRAINT reminder_kind_check
    CHECK (kind IN ('time', 'cadence'));
CREATE INDEX IF NOT EXISTS idx_reminder_invitation_token
    ON reminder(invitation_token) WHERE invitation_token IS NOT NULL;