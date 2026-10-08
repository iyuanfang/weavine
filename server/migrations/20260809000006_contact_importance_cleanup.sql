-- Contact importance 3-tier + drop reminder columns.

-- Migrate BEFORE tightening default: 'normal' values must be reassigned
-- before any new constraint excludes them.
UPDATE contact SET importance = 'medium' WHERE importance = 'normal';

ALTER TABLE contact DROP CONSTRAINT IF EXISTS contact_importance_check;
ALTER TABLE contact ADD CONSTRAINT contact_importance_check
    CHECK (importance IN ('low', 'medium', 'high'));

-- Drop the index that references the soon-to-be-dropped column.
DROP INDEX IF EXISTS idx_contact_reminder_enabled;

ALTER TABLE contact DROP COLUMN IF EXISTS reminder_enabled;
ALTER TABLE contact DROP COLUMN IF EXISTS reminder_interval_days;

ALTER TABLE contact ALTER COLUMN importance SET DEFAULT 'low';

-- Safety: ensure user_id index still exists after the column drops.
CREATE INDEX IF NOT EXISTS idx_contact_user_id ON contact(user_id);