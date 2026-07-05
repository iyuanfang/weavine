-- Migration 0002: Rename owner_id -> user_id on 11 domain tables, add server_revision + deleted_at.
-- SQLite-compatible TEXT columns preserved (no UUID casts).

CREATE SEQUENCE IF NOT EXISTS server_revision_seq START 1 INCREMENT 1;

ALTER TABLE contact           RENAME COLUMN owner_id TO user_id;
ALTER TABLE contact           ADD COLUMN IF NOT EXISTS server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE contact           ADD COLUMN IF NOT EXISTS deleted_at TEXT;

ALTER TABLE tag               RENAME COLUMN owner_id TO user_id;
ALTER TABLE tag               ADD COLUMN IF NOT EXISTS server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE tag               ADD COLUMN IF NOT EXISTS deleted_at TEXT;

ALTER TABLE project           RENAME COLUMN owner_id TO user_id;
ALTER TABLE project           ADD COLUMN IF NOT EXISTS server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE project           ADD COLUMN IF NOT EXISTS deleted_at TEXT;

ALTER TABLE event             RENAME COLUMN owner_id TO user_id;
ALTER TABLE event             ADD COLUMN IF NOT EXISTS server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE event             ADD COLUMN IF NOT EXISTS deleted_at TEXT;

ALTER TABLE action            RENAME COLUMN owner_id TO user_id;
ALTER TABLE action            ADD COLUMN IF NOT EXISTS server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE action            ADD COLUMN IF NOT EXISTS deleted_at TEXT;

ALTER TABLE interaction       RENAME COLUMN owner_id TO user_id;
ALTER TABLE interaction       ADD COLUMN IF NOT EXISTS server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE interaction       ADD COLUMN IF NOT EXISTS deleted_at TEXT;

ALTER TABLE reminder          RENAME COLUMN owner_id TO user_id;
ALTER TABLE reminder          ADD COLUMN IF NOT EXISTS server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE reminder          ADD COLUMN IF NOT EXISTS deleted_at TEXT;

ALTER TABLE setting           RENAME COLUMN owner_id TO user_id;
ALTER TABLE setting           ADD COLUMN IF NOT EXISTS server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE setting           ADD COLUMN IF NOT EXISTS deleted_at TEXT;

ALTER TABLE push_subscription RENAME COLUMN owner_id TO user_id;
ALTER TABLE push_subscription ADD COLUMN IF NOT EXISTS server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE push_subscription ADD COLUMN IF NOT EXISTS deleted_at TEXT;

-- contact_tag: add id column (composite PK does not work with sync trigger)
DO $$ BEGIN
    BEGIN EXECUTE 'ALTER TABLE contact_tag DROP CONSTRAINT contact_tag_pkey';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
END $$;
ALTER TABLE contact_tag ADD COLUMN IF NOT EXISTS id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_tag_pair ON contact_tag(contact_id, tag_id);
ALTER TABLE contact_tag RENAME COLUMN owner_id TO user_id;
ALTER TABLE contact_tag ADD COLUMN IF NOT EXISTS server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE contact_tag ADD COLUMN IF NOT EXISTS deleted_at TEXT;

-- project_contact: add id column
DO $$ BEGIN
    BEGIN EXECUTE 'ALTER TABLE project_contact DROP CONSTRAINT project_contact_pkey';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
END $$;
ALTER TABLE project_contact ADD COLUMN IF NOT EXISTS id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_contact_pair ON project_contact(project_id, contact_id);
ALTER TABLE project_contact RENAME COLUMN owner_id TO user_id;
ALTER TABLE project_contact ADD COLUMN IF NOT EXISTS server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE project_contact ADD COLUMN IF NOT EXISTS deleted_at TEXT;
