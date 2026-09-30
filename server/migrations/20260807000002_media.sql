CREATE TABLE IF NOT EXISTS media (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    user_id         TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL CHECK (kind IN ('avatar', 'card_image', 'attachment')),
    owner_type      TEXT NOT NULL,
    owner_id        TEXT NOT NULL,
    mime            TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL DEFAULT 0,
    sha256          TEXT,
    filename        TEXT,
    blob            BYTEA,
    server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq'),
    deleted_at      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, kind, owner_type, owner_id)
);

CREATE INDEX IF NOT EXISTS ix_media_owner      ON media (owner_type, owner_id);
CREATE INDEX IF NOT EXISTS ix_media_user_rev   ON media (user_id, server_revision);

DROP TRIGGER IF EXISTS media_sync ON media;
CREATE TRIGGER media_sync
BEFORE INSERT OR UPDATE OR DELETE ON media
FOR EACH ROW EXECUTE FUNCTION sync_log_change();