-- spec: Weavine-Phase2 brief §6 (cross-feature decisions)
-- Idempotent: safe on a fresh DB (column does not exist → skipped), on an existing
-- DB that still has city (rename happens), and on a DB that already has address
-- (nothing to do). No data loss — values move with the column rename.
--
-- Business cards carry full multi-line addresses (e.g. 上海市浦东新区...); storing
-- only the locality loses the street/postcode parts that OCR already extracts.
-- Renaming city → address makes the column match what OCR outputs and what
-- vCard ADR can supply in full.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'contact' AND column_name = 'city'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'contact' AND column_name = 'address'
    ) THEN
        ALTER TABLE contact RENAME COLUMN city TO address;
    END IF;
END $$;