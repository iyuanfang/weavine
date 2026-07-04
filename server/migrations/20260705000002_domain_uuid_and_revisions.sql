-- Migration 0002: Convert 11 domain tables owner_id (TEXT) → user_id (UUID)
-- and add server_revision + deleted_at columns.

CREATE SEQUENCE IF NOT EXISTS server_revision_seq START 1 INCREMENT 1;

ALTER TABLE contact           ALTER COLUMN owner_id TYPE UUID USING owner_id::UUID;
ALTER TABLE contact           RENAME COLUMN owner_id TO user_id;
ALTER TABLE contact           ADD COLUMN server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE contact           ADD COLUMN deleted_at TEXT;

ALTER TABLE tag               ALTER COLUMN owner_id TYPE UUID USING owner_id::UUID;
ALTER TABLE tag               RENAME COLUMN owner_id TO user_id;
ALTER TABLE tag               ADD COLUMN server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE tag               ADD COLUMN deleted_at TEXT;

-- contact_tag: add single id column (junction table has composite PK, need id for sync trigger)
ALTER TABLE contact_tag       DROP CONSTRAINT contact_tag_pkey;
ALTER TABLE contact_tag       ADD COLUMN id UUID PRIMARY KEY DEFAULT gen_random_uuid();
ALTER TABLE contact_tag       ADD UNIQUE (contact_id, tag_id);
ALTER TABLE contact_tag       ALTER COLUMN owner_id TYPE UUID USING owner_id::UUID;
ALTER TABLE contact_tag       RENAME COLUMN owner_id TO user_id;
ALTER TABLE contact_tag       ADD COLUMN server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE contact_tag       ADD COLUMN deleted_at TEXT;

ALTER TABLE project           ALTER COLUMN owner_id TYPE UUID USING owner_id::UUID;
ALTER TABLE project           RENAME COLUMN owner_id TO user_id;
ALTER TABLE project           ADD COLUMN server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE project           ADD COLUMN deleted_at TEXT;

-- project_contact: add single id column (junction table with composite PK)
ALTER TABLE project_contact   DROP CONSTRAINT project_contact_pkey;
ALTER TABLE project_contact   ADD COLUMN id UUID PRIMARY KEY DEFAULT gen_random_uuid();
ALTER TABLE project_contact   ADD UNIQUE (project_id, contact_id);
ALTER TABLE project_contact   ALTER COLUMN owner_id TYPE UUID USING owner_id::UUID;
ALTER TABLE project_contact   RENAME COLUMN owner_id TO user_id;
ALTER TABLE project_contact   ADD COLUMN server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE project_contact   ADD COLUMN deleted_at TEXT;

ALTER TABLE event             ALTER COLUMN owner_id TYPE UUID USING owner_id::UUID;
ALTER TABLE event             RENAME COLUMN owner_id TO user_id;
ALTER TABLE event             ADD COLUMN server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE event             ADD COLUMN deleted_at TEXT;

ALTER TABLE action            ALTER COLUMN owner_id TYPE UUID USING owner_id::UUID;
ALTER TABLE action            RENAME COLUMN owner_id TO user_id;
ALTER TABLE action            ADD COLUMN server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE action            ADD COLUMN deleted_at TEXT;

ALTER TABLE interaction       ALTER COLUMN owner_id TYPE UUID USING owner_id::UUID;
ALTER TABLE interaction       RENAME COLUMN owner_id TO user_id;
ALTER TABLE interaction       ADD COLUMN server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE interaction       ADD COLUMN deleted_at TEXT;

ALTER TABLE reminder          ALTER COLUMN owner_id TYPE UUID USING owner_id::UUID;
ALTER TABLE reminder          RENAME COLUMN owner_id TO user_id;
ALTER TABLE reminder          ADD COLUMN server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE reminder          ADD COLUMN deleted_at TEXT;

ALTER TABLE setting           ALTER COLUMN owner_id TYPE UUID USING owner_id::UUID;
ALTER TABLE setting           RENAME COLUMN owner_id TO user_id;
ALTER TABLE setting           ADD COLUMN server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE setting           ADD COLUMN deleted_at TEXT;

ALTER TABLE push_subscription ALTER COLUMN owner_id TYPE UUID USING owner_id::UUID;
ALTER TABLE push_subscription RENAME COLUMN owner_id TO user_id;
ALTER TABLE push_subscription ADD COLUMN server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE push_subscription ADD COLUMN deleted_at TEXT;
