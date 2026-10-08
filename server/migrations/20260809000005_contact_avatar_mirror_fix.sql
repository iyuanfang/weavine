-- Fix: the avatar-mirror trigger previously fired only on
-- `AFTER INSERT OR UPDATE OF deleted_at`. The media upload handler
-- upserts with `ON CONFLICT DO UPDATE SET storage_key, …` (no deleted_at),
-- so re-uploading an avatar never updated contact.avatar_storage_key.
-- Now it fires on any UPDATE; the trigger body already handles logic.
DROP TRIGGER IF EXISTS sync_contact_avatar_ins ON media;
CREATE TRIGGER sync_contact_avatar_ins
    AFTER INSERT OR UPDATE ON media
    FOR EACH ROW
    EXECUTE FUNCTION sync_contact_avatar();