CREATE TABLE IF NOT EXISTS note (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    user_id         TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    body            TEXT NOT NULL DEFAULT '',
    server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq'),
    deleted_at      TEXT,
    archived_at     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_note_user_updated ON note (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_note_rev          ON note (user_id, server_revision);

DROP TRIGGER IF EXISTS note_sync ON note;
CREATE TRIGGER note_sync
BEFORE INSERT OR UPDATE OR DELETE ON note
FOR EACH ROW EXECUTE FUNCTION sync_log_change();

CREATE TABLE IF NOT EXISTS note_entity (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    note_id         TEXT NOT NULL REFERENCES note(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    entity_type     TEXT NOT NULL CHECK (entity_type IN ('contact','project','action','event')),
    entity_id       TEXT NOT NULL,
    server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq'),
    deleted_at      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (note_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS ix_note_entity_note   ON note_entity (note_id);
CREATE INDEX IF NOT EXISTS ix_note_entity_target ON note_entity (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS ix_note_entity_rev    ON note_entity (user_id, server_revision);

DROP TRIGGER IF EXISTS note_entity_sync ON note_entity;
CREATE TRIGGER note_entity_sync
BEFORE INSERT OR UPDATE OR DELETE ON note_entity
FOR EACH ROW EXECUTE FUNCTION sync_log_change();