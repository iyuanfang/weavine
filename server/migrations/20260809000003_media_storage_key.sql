ALTER TABLE media
    ADD COLUMN IF NOT EXISTS storage_key TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS width       INTEGER,
    ADD COLUMN IF NOT EXISTS height      INTEGER,
    ADD COLUMN IF NOT EXISTS alt_text    TEXT;

DELETE FROM media WHERE storage_key = '';

ALTER TABLE media
    ALTER COLUMN storage_key DROP DEFAULT,
    DROP COLUMN IF EXISTS blob;

CREATE INDEX IF NOT EXISTS ix_media_storage_key ON media (storage_key) WHERE deleted_at IS NULL;