-- Add archived_at column to contact table for archive support.
-- Matches the pattern used by project, event, action, and note.

ALTER TABLE contact ADD COLUMN archived_at TEXT;
CREATE INDEX IF NOT EXISTS idx_contact_archived_at ON contact(archived_at);