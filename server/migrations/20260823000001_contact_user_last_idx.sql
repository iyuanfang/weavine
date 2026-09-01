-- 20260823000001_contact_user_last_idx.sql
--
-- Backs the v1.2.0 keep-in-touch scheduler fix
-- (server/src/keep_in_touch_server.rs). The tick queries
--   SELECT id, importance, last_interaction_at, keep_in_touch_cadence_days
--     FROM contact WHERE deleted_at IS NULL
-- which on a multi-tenant table is unindexed and does a full heap scan
-- once per user per day. The partial composite index below is what the
-- planner needs to keep the scan bounded as user count grows.

CREATE INDEX IF NOT EXISTS idx_contact_user_last
    ON contact (user_id, last_interaction_at)
    WHERE deleted_at IS NULL;