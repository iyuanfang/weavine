-- Migration 20260828000001: extend interaction.source CHECK to allow 'archive'
--
-- Server-side archive-hook (handlers/action.rs::update +
-- handlers/event.rs::update) writes Interaction rows with source='archive'
-- on the None → Some(archived_at) transition. Desktop side already includes
-- 'archive' in the local CHECK (see src-tauri/src/migration.rs); this
-- migration brings PG into parity.

ALTER TABLE interaction DROP CONSTRAINT IF EXISTS interaction_source_check;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'interaction_source_check'
    ) THEN
        ALTER TABLE interaction
            ADD CONSTRAINT interaction_source_check
            CHECK (source = ANY (ARRAY[
                'manual'::text,
                'event'::text,
                'action'::text,
                'archive'::text
            ]));
    END IF;
END $$;
