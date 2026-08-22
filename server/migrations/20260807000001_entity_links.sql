CREATE TABLE IF NOT EXISTS entity_links (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    user_id         TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    from_type       TEXT NOT NULL CHECK (from_type IN ('contact','event','action','project','interaction')),
    from_id         TEXT NOT NULL,
    to_type         TEXT NOT NULL CHECK (to_type IN ('contact','event','action','project','interaction')),
    to_id           TEXT NOT NULL,
    relation_type   TEXT NOT NULL CHECK (relation_type IN ('participated','involved','regards')),
    role            TEXT NOT NULL DEFAULT 'participant',
    server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq'),
    deleted_at      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, from_type, from_id, to_type, to_id, relation_type)
);

CREATE INDEX IF NOT EXISTS ix_entity_link_event   ON entity_links (from_id) WHERE from_type = 'event';
CREATE INDEX IF NOT EXISTS ix_entity_link_contact ON entity_links (to_id)   WHERE to_type = 'contact';
CREATE INDEX IF NOT EXISTS ix_entity_link_rev     ON entity_links (user_id, server_revision);

DROP TRIGGER IF EXISTS entity_link_sync ON entity_links;
CREATE TRIGGER entity_link_sync
BEFORE INSERT OR UPDATE OR DELETE ON entity_links
FOR EACH ROW EXECUTE FUNCTION sync_log_change();