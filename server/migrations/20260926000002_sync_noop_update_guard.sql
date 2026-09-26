-- Stop no-op UPDATEs from appending to `sync_change_log`.
--
-- `sync_log_change` fires on `BEFORE INSERT OR UPDATE OR DELETE ... FOR EACH
-- ROW` and unconditionally inserts a log row and consumes a revision from
-- `server_revision_seq`. It did not distinguish "the row changed" from "an
-- UPDATE statement ran".
--
-- That distinction matters because of how push writes rows. For the kinds that
-- carry `updated_at` (contact, project, event, action, setting, media, note) the
-- server compares timestamps first and skips the write when the client's value
-- is not newer, so a redundant push costs a SELECT but no log row. For every
-- other synced table — tag, interaction, reminder, contact_tag,
-- project_contact, entity_link, note_entity — there is no `updated_at` to
-- compare against, so the upsert runs unconditionally. The client has no
-- timestamp to filter on either, so it re-sends those tables **in full on every
-- sync cycle**.
--
-- Net effect: every cycle rewrote every interaction, tag, reminder and junction
-- row, and every rewrite appended a change-log entry with a fresh revision. The
-- log therefore grew linearly with the number of sync cycles for data that had
-- not changed at all — and `sync_change_log` is exactly what the next device's
-- pull has to walk. Slow sync fed itself. On an account with a few thousand
-- interactions and a five-minute cycle that is ~100k pointless log rows a year,
-- each holding a full row snapshot.
--
-- The guard makes the trigger log actual changes only:
--
--   * INSERT — `OLD` is NULL, `to_jsonb(NEW) = to_jsonb(OLD)` is never true for
--     a real row, so every insert still logs.
--   * DELETE — `TG_OP` is not 'UPDATE', so every delete still logs.
--   * UPDATE — logged only when at least one column actually differs.
--
-- Note what is deliberately *not* logged: a no-op update leaves the row's
-- `server_revision` alone. That is the correct outcome — there is nothing for
-- another device to pick up, so it does not need to be re-delivered.
--
-- Everything else in the function is unchanged from
-- 20260705000003_sync_engine.sql; the triggers already point at this function,
-- so replacing the body is enough (no trigger recreation).

CREATE OR REPLACE FUNCTION sync_log_change() RETURNS TRIGGER AS $$
DECLARE
    v_user_id TEXT;
    v_row_id TEXT;
    v_device_id TEXT;
    v_data JSONB;
    v_op TEXT;
    v_rev BIGINT;
BEGIN
    v_op := TG_OP;

    -- The guard. Without it, the unconditional re-push of the tables that have
    -- no `updated_at` grows the change log on every cycle.
    IF TG_OP = 'UPDATE' AND to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_user_id := NEW.user_id;
        v_row_id := NEW.id;
        v_data := to_jsonb(NEW);
    ELSIF TG_OP = 'UPDATE' THEN
        v_user_id := NEW.user_id;
        v_row_id := NEW.id;
        v_data := to_jsonb(NEW);
    ELSE
        v_user_id := OLD.user_id;
        v_row_id := OLD.id;
        v_data := NULL;
    END IF;

    BEGIN
        v_device_id := current_setting('app.current_device_id');
    EXCEPTION WHEN OTHERS THEN
        v_device_id := NULL;
    END;

    v_rev := nextval('server_revision_seq');

    INSERT INTO sync_change_log(user_id, device_id, table_name, row_id, op, server_revision, data, changed_at)
    VALUES (v_user_id, v_device_id, TG_TABLE_NAME, v_row_id, v_op, v_rev, v_data, to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'));

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    NEW.server_revision := v_rev;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
