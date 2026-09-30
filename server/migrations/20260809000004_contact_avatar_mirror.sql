ALTER TABLE contact ADD COLUMN IF NOT EXISTS avatar_storage_key TEXT;
ALTER TABLE contact ADD COLUMN IF NOT EXISTS avatar_mime TEXT;
ALTER TABLE contact ADD COLUMN IF NOT EXISTS avatar_width INTEGER;
ALTER TABLE contact ADD COLUMN IF NOT EXISTS avatar_height INTEGER;
ALTER TABLE contact ADD COLUMN IF NOT EXISTS avatar_alt_text TEXT;

CREATE OR REPLACE FUNCTION sync_contact_avatar() RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        UPDATE contact
           SET avatar_storage_key = NULL,
               avatar_mime = NULL,
               avatar_width = NULL,
               avatar_height = NULL,
               avatar_alt_text = NULL,
               updated_at = now()
         WHERE id = OLD.owner_id
           AND OLD.kind = 'avatar'
           AND OLD.owner_type = 'contact';
        RETURN OLD;
    END IF;

    IF NEW.kind = 'avatar' AND NEW.owner_type = 'contact' AND NEW.deleted_at IS NULL THEN
        UPDATE contact
           SET avatar_storage_key = NEW.storage_key,
               avatar_mime = NEW.mime,
               avatar_width = NEW.width,
               avatar_height = NEW.height,
               avatar_alt_text = NEW.alt_text,
               updated_at = now()
         WHERE id = NEW.owner_id;
    ELSIF NEW.kind = 'avatar' AND NEW.owner_type = 'contact' AND NEW.deleted_at IS NOT NULL THEN
        UPDATE contact
           SET avatar_storage_key = NULL,
               avatar_mime = NULL,
               avatar_width = NULL,
               avatar_height = NULL,
               avatar_alt_text = NULL,
               updated_at = now()
         WHERE id = NEW.owner_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_contact_avatar_ins ON media;
CREATE TRIGGER sync_contact_avatar_ins
    AFTER INSERT OR UPDATE OF deleted_at ON media
    FOR EACH ROW
    EXECUTE FUNCTION sync_contact_avatar();

DROP TRIGGER IF EXISTS sync_contact_avatar_del ON media;
CREATE TRIGGER sync_contact_avatar_del
    AFTER DELETE ON media
    FOR EACH ROW
    EXECUTE FUNCTION sync_contact_avatar();