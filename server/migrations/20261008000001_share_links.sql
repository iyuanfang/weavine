-- Per-item share links (notes & events) + anonymous RSVP responses.
--
-- Snapshot model: the shared content is COPIED into the row at share time —
-- the public page never touches the live note/event tables. Benefits:
--   * works for desktop users whose data lives in local SQLite (the server
--     only ever sees the snapshot),
--   * privacy: later edits don't leak; the owner refreshes the snapshot
--     explicitly ("更新内容") or revokes the link.
-- Revocation is soft (revoked_at) so the owner keeps view stats; revoked
-- rows are excluded from every public read.
-- Third-party privacy (per docs/design/share-feature.md §6): the public page
-- renders only the snapshot — linked contacts/tags never leave the building.

CREATE TABLE IF NOT EXISTS share_link (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('note', 'event')),
    entity_id TEXT NOT NULL,
    -- Snapshot at share/refresh time. content = markdown text (note body or
    -- event description); event columns are NULL for notes.
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    event_start TEXT,
    event_end TEXT,
    event_location TEXT,
    view_count BIGINT NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_share_link_entity
    ON share_link (entity_type, entity_id, user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS share_rsvp (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    name TEXT NOT NULL,
    response TEXT NOT NULL CHECK (response IN ('yes', 'maybe', 'no')),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_share_rsvp_token
    ON share_rsvp (token, created_at);
