-- Fix the snapshot indexes for the two composite-key junction tables.
--
-- `20260926000001_sync_snapshot_and_prune_safety.sql` created:
--
--   idx_contact_tag_user_live      ON contact_tag (user_id, contact_id, tag_id)
--   idx_project_contact_user_live  ON project_contact (user_id, project_id, contact_id)
--
-- on the belief — stated in that file's comment — that the junction tables
-- "paginate by OFFSET over a composite ORDER BY". They do not. `snapshot`
-- (`server/src/handlers/sync.rs`) uses one keyset shape for every kind:
--
--   WHERE user_id = $1 AND deleted_at IS NULL AND ($2 = '' OR id > $2)
--   ORDER BY id LIMIT $3
--
-- `id` is the added-for-the-trigger column (`20260705000002` gave both tables
-- one precisely so `sync_log_change()` can read `NEW.id`), and it is a random
-- UUID. An index on the composite pair can filter by `user_id` but cannot
-- produce `id` order, so every page still sorts the user's whole membership set
-- — which is exactly the cost the index was added to avoid.
--
-- Corrected shape mirrors the other ten tables: `(user_id, id)`, partial on
-- `deleted_at IS NULL` to match the snapshot's predicate exactly.
--
-- Non-obvious detail worth keeping: `id` is random, so this index is *not* an
-- append-friendly one — but that is fine and intentional. The snapshot is a
-- cold path (first sync / recovery bootstrap), and the alternative, ordering by
-- insertion, is not available: the changelog is the only insertion order and it
-- is what the snapshot exists to avoid replaying.
--
-- The mismatched pair is dropped rather than left in place: `(user_id, id)`
-- serves every query the composite pair could (same leading column), so keeping
-- both would only add write amplification.
DROP INDEX IF EXISTS idx_contact_tag_user_live;
DROP INDEX IF EXISTS idx_project_contact_user_live;

CREATE INDEX IF NOT EXISTS idx_contact_tag_user_id_live
    ON contact_tag (user_id, id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_contact_user_id_live
    ON project_contact (user_id, id) WHERE deleted_at IS NULL;

-- Known, deliberately not fixed here: for the five kinds that carry both
-- `archived_at` and `deleted_at`, the snapshot predicate is
-- `(deleted_at IS NOT NULL OR r.archived_at IS NULL)`, which does not match the
-- `WHERE deleted_at IS NULL` partial predicate of their `idx_*_user_id_live`
-- indexes — so those pages fall back to sorting as well. The topic is tracked in
-- the spec (§18.3) together with the other index work, which the product owner
-- deferred until volume makes it bite.
