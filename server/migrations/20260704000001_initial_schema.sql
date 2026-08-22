CREATE TABLE IF NOT EXISTS user_account (
    id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    email         TEXT NOT NULL,
    name          TEXT,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_token (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    user_id    TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    device     TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS tag (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    owner_id   TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    color      TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contact (
    id                     TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    owner_id               TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    nickname               TEXT NOT NULL,
    name                   TEXT,
    company                TEXT,
    title                  TEXT,
    city                   TEXT,
    email                  TEXT,
    phone                  TEXT,
    wechat                 TEXT,
    notes                  TEXT,
    importance             TEXT NOT NULL DEFAULT 'normal',
    reminder_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    reminder_interval_days INTEGER,
    last_contacted_at      TEXT,
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_tag (
    owner_id   TEXT NOT NULL,
    contact_id TEXT NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
    tag_id     TEXT NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
    PRIMARY KEY (contact_id, tag_id)
);

CREATE TABLE IF NOT EXISTS project (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    owner_id     TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT,
    template     TEXT NOT NULL,
    stage        TEXT NOT NULL,
    start_at     TEXT,
    due_at       TEXT,
    completed_at TEXT,
    archived_at  TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_contact (
    owner_id   TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
    role       TEXT,
    added_at   TEXT NOT NULL,
    PRIMARY KEY (project_id, contact_id)
);

CREATE TABLE IF NOT EXISTS event (
    id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    owner_id              TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    title                 TEXT NOT NULL,
    event_type            TEXT NOT NULL DEFAULT 'event',
    start_at              TEXT NOT NULL,
    end_at                TEXT,
    location              TEXT,
    notes                 TEXT,
    reminder_lead_minutes INTEGER,
    contact_id            TEXT REFERENCES contact(id) ON DELETE SET NULL,
    project_id            TEXT REFERENCES project(id) ON DELETE SET NULL,
    archived_at           TEXT,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    owner_id     TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT,
    status       TEXT NOT NULL DEFAULT 'inbox',
    priority     INTEGER NOT NULL DEFAULT 0,
    category     TEXT,
    due_at       TEXT,
    contact_id   TEXT REFERENCES contact(id) ON DELETE SET NULL,
    project_id   TEXT REFERENCES project(id) ON DELETE SET NULL,
    completed_at TEXT,
    archived_at  TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interaction (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    owner_id    TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    contact_id  TEXT REFERENCES contact(id) ON DELETE SET NULL,
    action_id   TEXT REFERENCES action(id) ON DELETE SET NULL,
    event_id    TEXT REFERENCES event(id) ON DELETE SET NULL,
    occurred_at TEXT NOT NULL,
    channel     TEXT,
    summary     TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminder (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    owner_id    TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    contact_id  TEXT REFERENCES contact(id) ON DELETE CASCADE,
    event_id    TEXT REFERENCES event(id) ON DELETE CASCADE,
    trigger_at  TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'event',
    dispatched  BOOLEAN NOT NULL DEFAULT FALSE,
    dismissed   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS setting (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    owner_id   TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscription (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    owner_id   TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    endpoint   TEXT NOT NULL,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_account_email ON user_account(email);
CREATE UNIQUE INDEX IF NOT EXISTS uq_refresh_token_hash ON refresh_token(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_token_user ON refresh_token(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tag_owner_name ON tag(owner_id, name);
CREATE INDEX IF NOT EXISTS idx_contact_owner_name ON contact(owner_id, nickname);
CREATE INDEX IF NOT EXISTS idx_contact_owner_importance ON contact(owner_id, importance);
CREATE INDEX IF NOT EXISTS idx_contact_owner_last_contacted ON contact(owner_id, last_contacted_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_owner_email ON contact(owner_id, email);
CREATE INDEX IF NOT EXISTS idx_contact_tag_owner ON contact_tag(owner_id);
CREATE INDEX IF NOT EXISTS idx_contact_tag_tag ON contact_tag(tag_id);
CREATE INDEX IF NOT EXISTS idx_project_owner_template ON project(owner_id, template);
CREATE INDEX IF NOT EXISTS idx_project_owner_stage ON project(owner_id, stage);
CREATE INDEX IF NOT EXISTS idx_project_archived_at ON project(archived_at);
CREATE INDEX IF NOT EXISTS idx_project_contact_owner ON project_contact(owner_id);
CREATE INDEX IF NOT EXISTS idx_project_contact_contact ON project_contact(contact_id);
CREATE INDEX IF NOT EXISTS idx_event_owner_start ON event(owner_id, start_at);
CREATE INDEX IF NOT EXISTS idx_event_owner_contact ON event(owner_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_event_owner_project ON event(owner_id, project_id);
CREATE INDEX IF NOT EXISTS idx_event_archived_at ON event(archived_at);
CREATE INDEX IF NOT EXISTS idx_action_owner_status_due ON action(owner_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_action_owner_contact ON action(owner_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_action_owner_project ON action(owner_id, project_id);
CREATE INDEX IF NOT EXISTS idx_action_archived_at ON action(archived_at);
CREATE INDEX IF NOT EXISTS idx_interaction_owner_occurred ON interaction(owner_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_interaction_owner_contact ON interaction(owner_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_reminder_owner_trigger ON reminder(owner_id, trigger_at, dispatched, dismissed);
CREATE INDEX IF NOT EXISTS idx_reminder_owner_contact ON reminder(owner_id, contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_setting_owner_key ON setting(owner_id, key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_endpoint ON push_subscription(endpoint);
CREATE INDEX IF NOT EXISTS idx_push_owner ON push_subscription(owner_id);
