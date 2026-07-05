-- Migration 0003: Sync engine - sync_meta, sync_manifest, sync_change_log, trigger function, 11 triggers.
-- TEXT-compatible types only (no UUID casts).

CREATE TABLE IF NOT EXISTS sync_meta (
    user_id               TEXT PRIMARY KEY REFERENCES user_account(id) ON DELETE CASCADE,
    last_pulled_revision  BIGINT NOT NULL DEFAULT 0,
    last_pushed_revision  BIGINT NOT NULL DEFAULT 0,
    last_sync_at          TEXT
);

CREATE TABLE IF NOT EXISTS sync_manifest (
    user_id          TEXT PRIMARY KEY REFERENCES user_account(id) ON DELETE CASCADE,
    schema_version   INT NOT NULL DEFAULT 1,
    server_revision  BIGINT NOT NULL DEFAULT 0,
    last_updated     TEXT
);

CREATE TABLE IF NOT EXISTS sync_change_log (
    id               BIGSERIAL PRIMARY KEY,
    user_id          TEXT NOT NULL,
    device_id        TEXT,
    table_name       TEXT NOT NULL,
    row_id           TEXT NOT NULL,
    op               TEXT NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
    server_revision  BIGINT NOT NULL,
    data             JSONB,
    changed_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_change_log_user_rev ON sync_change_log(user_id, server_revision);
CREATE INDEX IF NOT EXISTS idx_change_log_user_table_rev ON sync_change_log(user_id, table_name, server_revision);

-- Trigger function: captures all mutations on domain tables into sync_change_log.
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

CREATE TRIGGER contact_sync
    BEFORE INSERT OR UPDATE OR DELETE ON contact
    FOR EACH ROW EXECUTE FUNCTION sync_log_change();

CREATE TRIGGER tag_sync
    BEFORE INSERT OR UPDATE OR DELETE ON tag
    FOR EACH ROW EXECUTE FUNCTION sync_log_change();

CREATE TRIGGER contact_tag_sync
    BEFORE INSERT OR UPDATE OR DELETE ON contact_tag
    FOR EACH ROW EXECUTE FUNCTION sync_log_change();

CREATE TRIGGER project_sync
    BEFORE INSERT OR UPDATE OR DELETE ON project
    FOR EACH ROW EXECUTE FUNCTION sync_log_change();

CREATE TRIGGER project_contact_sync
    BEFORE INSERT OR UPDATE OR DELETE ON project_contact
    FOR EACH ROW EXECUTE FUNCTION sync_log_change();

CREATE TRIGGER event_sync
    BEFORE INSERT OR UPDATE OR DELETE ON event
    FOR EACH ROW EXECUTE FUNCTION sync_log_change();

CREATE TRIGGER action_sync
    BEFORE INSERT OR UPDATE OR DELETE ON action
    FOR EACH ROW EXECUTE FUNCTION sync_log_change();

CREATE TRIGGER interaction_sync
    BEFORE INSERT OR UPDATE OR DELETE ON interaction
    FOR EACH ROW EXECUTE FUNCTION sync_log_change();

CREATE TRIGGER reminder_sync
    BEFORE INSERT OR UPDATE OR DELETE ON reminder
    FOR EACH ROW EXECUTE FUNCTION sync_log_change();

CREATE TRIGGER setting_sync
    BEFORE INSERT OR UPDATE OR DELETE ON setting
    FOR EACH ROW EXECUTE FUNCTION sync_log_change();

CREATE TRIGGER push_subscription_sync
    BEFORE INSERT OR UPDATE OR DELETE ON push_subscription
    FOR EACH ROW EXECUTE FUNCTION sync_log_change();
