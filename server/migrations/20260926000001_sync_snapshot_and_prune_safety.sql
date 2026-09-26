-- Snapshot bootstrap + prune safety.
--
-- Two coupled problems motivated this migration:
--
-- 1. A device that has never synced (or that is far behind) had only one way
--    to catch up: replay `sync_change_log` from revision 0. That log holds one
--    row per INSERT/UPDATE/DELETE, so the volume is "how many times you edited
--    things", not "how many things you have" — one to two orders of magnitude
--    larger. First sync on a phone therefore took minutes.
--    GET /api/sync/snapshot now serves current-state rows per table instead.
--
-- 2. `prune_change_log` deletes by age only. A device that stayed offline
--    longer than the TTL comes back, pulls from its stale cursor, and receives
--    nothing for the gap — silent, permanent data loss. We now record how far
--    the log has been pruned, so the server can tell such a client to
--    bootstrap from the snapshot instead.

-- Highest change-log revision that has been pruned away for this user. A pull
-- cursor below this mark can no longer be advanced by the incremental stream.
ALTER TABLE sync_meta
    ADD COLUMN IF NOT EXISTS pruned_through_revision BIGINT NOT NULL DEFAULT 0;

-- Snapshot pagination reads `WHERE user_id = ? AND deleted_at IS NULL
-- [AND archived_at IS NULL] ORDER BY id LIMIT n`. These partial indexes let
-- Postgres walk the rows in id order instead of sorting the whole user's set
-- on every page (id is a random UUID, so that sort is not cheap).
CREATE INDEX IF NOT EXISTS idx_contact_user_id_live
    ON contact (user_id, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_event_user_id_live
    ON event (user_id, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_action_user_id_live
    ON action (user_id, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_interaction_user_id_live
    ON interaction (user_id, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_note_user_id_live
    ON note (user_id, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_media_user_id_live
    ON media (user_id, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tag_user_id_live
    ON tag (user_id, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_user_id_live
    ON project (user_id, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_setting_user_id_live
    ON setting (user_id, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reminder_user_id_live
    ON reminder (user_id, id) WHERE deleted_at IS NULL;

-- Junction tables paginate by OFFSET over a composite ORDER BY (they have a
-- composite key and the `id` added later is only there for the change-log
-- trigger), so the index has to match the ORDER BY columns.
CREATE INDEX IF NOT EXISTS idx_contact_tag_user_live
    ON contact_tag (user_id, contact_id, tag_id);
CREATE INDEX IF NOT EXISTS idx_project_contact_user_live
    ON project_contact (user_id, project_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_note_entity_user_live
    ON note_entity (user_id, id);
CREATE INDEX IF NOT EXISTS idx_entity_links_user_live
    ON entity_links (user_id, id);
