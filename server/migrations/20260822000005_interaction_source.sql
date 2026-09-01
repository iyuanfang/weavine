-- Migration 20260822000005: interaction source + source_ref

ALTER TABLE interaction
    ADD COLUMN IF NOT EXISTS source     TEXT NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS source_ref TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'interaction_source_check'
    ) THEN
        ALTER TABLE interaction
            ADD CONSTRAINT interaction_source_check
            CHECK (source IN ('manual', 'event', 'todo'));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_interaction_source_ref_contact
    ON interaction (source, source_ref, contact_id)
 WHERE source IS NOT NULL
   AND source_ref IS NOT NULL
   AND contact_id IS NOT NULL
   AND deleted_at IS NULL;
