/// Embedded schema migration for weavine.
///
/// Runs the DDL embedded in `SCHEMA_SQL` against a rusqlite Connection using
/// `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` so the
/// function is idempotent (safe to call on every startup).
///
/// Edit the `SCHEMA_SQL` constant below to change the schema. The application
/// bootstraps a fresh database automatically on first launch.
use rusqlite::Connection;

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" DATETIME,
    "image" TEXT,
    "wechatUnionId" TEXT,
    "openidWeb" TEXT,
    "openidMini" TEXT,
    "passwordHash" TEXT,
    "isLocal" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT
);

CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "expires" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "nickname" TEXT NOT NULL,
    "name" TEXT,
    "company" TEXT,
    "title" TEXT,
    "city" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "wechat" TEXT,
    "notes" TEXT,
    "importance" TEXT NOT NULL DEFAULT 'normal',
    "reminderEnabled" INTEGER NOT NULL DEFAULT 1,
    "reminderIntervalDays" INTEGER,
    "lastContactedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "ContactTag" (
    "ownerId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL REFERENCES "Contact"("id") ON DELETE CASCADE,
    "tagId" TEXT NOT NULL REFERENCES "Tag"("id") ON DELETE CASCADE,
    PRIMARY KEY ("contactId", "tagId")
);

CREATE TABLE IF NOT EXISTS "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'event',
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME,
    "location" TEXT,
    "notes" TEXT,
    "reminderEnabled" INTEGER NOT NULL DEFAULT 1,
    "reminderAt" DATETIME,
    "contactId" TEXT REFERENCES "Contact"("id") ON DELETE SET NULL,
    "projectId" TEXT REFERENCES "Project"("id") ON DELETE SET NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "Action" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'inbox',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT,
    "dueAt" DATETIME,
    "contactId" TEXT REFERENCES "Contact"("id") ON DELETE SET NULL,
    "completedAt" DATETIME,
    "projectId" TEXT REFERENCES "Project"("id") ON DELETE SET NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "Interaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "contactId" TEXT REFERENCES "Contact"("id") ON DELETE SET NULL,
    "actionId" TEXT REFERENCES "Action"("id") ON DELETE SET NULL,
    "eventId" TEXT REFERENCES "Event"("id") ON DELETE SET NULL,
    "occurredAt" DATETIME NOT NULL,
    "channel" TEXT,
    "summary" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Reminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "contactId" TEXT REFERENCES "Contact"("id") ON DELETE CASCADE,
    "eventId" TEXT REFERENCES "Event"("id") ON DELETE CASCADE,
    "triggerAt" DATETIME NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'event',
    "dispatched" INTEGER NOT NULL DEFAULT 0,
    "dismissed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Setting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "PushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "template" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "startAt" DATETIME,
    "dueAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "ProjectContact" (
    "ownerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
    "contactId" TEXT NOT NULL REFERENCES "Contact"("id") ON DELETE CASCADE,
    "role" TEXT,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("projectId", "contactId")
);
"#;

const INDEX_SQL: &str = r#"
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "User_wechatUnionId_key" ON "User"("wechatUnionId");
CREATE UNIQUE INDEX IF NOT EXISTS "User_openidWeb_key" ON "User"("openidWeb");
CREATE UNIQUE INDEX IF NOT EXISTS "User_openidMini_key" ON "User"("openidMini");
CREATE INDEX IF NOT EXISTS "User_wechatUnionId_idx" ON "User"("wechatUnionId");
CREATE INDEX IF NOT EXISTS "Account_userId_idx" ON "Account"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");
CREATE UNIQUE INDEX IF NOT EXISTS "Session_sessionToken_key" ON "Session"("sessionToken");
CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "VerificationToken_token_key" ON "VerificationToken"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");
CREATE INDEX IF NOT EXISTS "Contact_ownerId_nickname_idx" ON "Contact"("ownerId", "nickname");
CREATE INDEX IF NOT EXISTS "Contact_ownerId_name_idx" ON "Contact"("ownerId", "name");
CREATE INDEX IF NOT EXISTS "Contact_ownerId_company_idx" ON "Contact"("ownerId", "company");
CREATE INDEX IF NOT EXISTS "Contact_ownerId_city_idx" ON "Contact"("ownerId", "city");
CREATE INDEX IF NOT EXISTS "Contact_ownerId_importance_idx" ON "Contact"("ownerId", "importance");
CREATE INDEX IF NOT EXISTS "Contact_ownerId_reminderEnabled_lastContactedAt_idx" ON "Contact"("ownerId", "reminderEnabled", "lastContactedAt");
CREATE INDEX IF NOT EXISTS "Contact_ownerId_lastContactedAt_updatedAt_idx" ON "Contact"("ownerId", "lastContactedAt", "updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "Contact_ownerId_email_key" ON "Contact"("ownerId", "email");
CREATE UNIQUE INDEX IF NOT EXISTS "Tag_ownerId_name_key" ON "Tag"("ownerId", "name");
CREATE INDEX IF NOT EXISTS "ContactTag_ownerId_idx" ON "ContactTag"("ownerId");
CREATE INDEX IF NOT EXISTS "ContactTag_tagId_idx" ON "ContactTag"("tagId");
CREATE INDEX IF NOT EXISTS "Event_ownerId_startAt_idx" ON "Event"("ownerId", "startAt");
CREATE INDEX IF NOT EXISTS "Event_ownerId_contactId_idx" ON "Event"("ownerId", "contactId");
CREATE INDEX IF NOT EXISTS "Interaction_ownerId_contactId_occurredAt_idx" ON "Interaction"("ownerId", "contactId", "occurredAt");
CREATE INDEX IF NOT EXISTS "Interaction_ownerId_occurredAt_idx" ON "Interaction"("ownerId", "occurredAt");
CREATE INDEX IF NOT EXISTS "Action_ownerId_status_dueAt_idx" ON "Action"("ownerId", "status", "dueAt");
CREATE INDEX IF NOT EXISTS "Action_ownerId_contactId_idx" ON "Action"("ownerId", "contactId");
CREATE INDEX IF NOT EXISTS "Reminder_ownerId_triggerAt_dispatched_dismissed_idx" ON "Reminder"("ownerId", "triggerAt", "dispatched", "dismissed");
CREATE INDEX IF NOT EXISTS "Reminder_ownerId_contactId_idx" ON "Reminder"("ownerId", "contactId");
CREATE INDEX IF NOT EXISTS "Reminder_ownerId_contactId_kind_triggerAt_idx" ON "Reminder"("ownerId", "contactId", "kind", "triggerAt");
CREATE UNIQUE INDEX IF NOT EXISTS "Setting_ownerId_key_key" ON "Setting"("ownerId", "key");
CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_ownerId_idx" ON "PushSubscription"("ownerId");
CREATE INDEX IF NOT EXISTS "Project_ownerId_template_idx" ON "Project"("ownerId", "template");
CREATE INDEX IF NOT EXISTS "Project_ownerId_stage_idx" ON "Project"("ownerId", "stage");
CREATE INDEX IF NOT EXISTS "Action_ownerId_projectId_idx" ON "Action"("ownerId", "projectId");
CREATE INDEX IF NOT EXISTS "Event_ownerId_projectId_idx" ON "Event"("ownerId", "projectId");
CREATE INDEX IF NOT EXISTS "ProjectContact_ownerId_idx" ON "ProjectContact"("ownerId");
CREATE INDEX IF NOT EXISTS "ProjectContact_contactId_idx" ON "ProjectContact"("contactId");
"#;

/// Run all migrations (idempotent).
///
/// Creates tables and indexes if they do not already exist. Safe to call
/// on every startup.
pub fn run(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(SCHEMA_SQL)?;
    conn.execute_batch(INDEX_SQL)?;
    seed_default_user(conn)?;
    seed_default_tags(conn)?;

    // Idempotent migration: drop legacy Action.eventId column if present.
    let has_event_id: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('Action') WHERE name='eventId'",
        [],
        |r| r.get(0),
    )?;
    if has_event_id > 0 {
        conn.execute("DROP INDEX IF EXISTS \"Action_ownerId_eventId_idx\"", [])?;
        conn.execute("ALTER TABLE \"Action\" DROP COLUMN \"eventId\"", [])?;
    }

    // Idempotent migration: add Event.reminderLeadMinutes if missing.
    let has_reminder_lead: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('Event') WHERE name='reminderLeadMinutes'",
        [],
        |r| r.get(0),
    )?;
    if has_reminder_lead == 0 {
        conn.execute(
            "ALTER TABLE \"Event\" ADD COLUMN \"reminderLeadMinutes\" INTEGER",
            [],
        )?;
    }

    // Idempotent migration: Project table + ProjectContact
    // Fresh DBs get these from SCHEMA_SQL; this no-ops for them.
    let has_project: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('Project') WHERE name='id'",
        [],
        |r| r.get(0),
    )?;
    if has_project == 0 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS \"Project\" (\
                \"id\" TEXT NOT NULL PRIMARY KEY,\
                \"ownerId\" TEXT NOT NULL REFERENCES \"User\"(\"id\") ON DELETE CASCADE,\
                \"title\" TEXT NOT NULL,\
                \"description\" TEXT,\
                \"template\" TEXT NOT NULL,\
                \"stage\" TEXT NOT NULL,\
                \"startAt\" DATETIME,\
                \"dueAt\" DATETIME,\
                \"completedAt\" DATETIME,\
                \"createdAt\" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\
                \"updatedAt\" DATETIME NOT NULL\
            );\
            CREATE TABLE IF NOT EXISTS \"ProjectContact\" (\
                \"ownerId\" TEXT NOT NULL,\
                \"projectId\" TEXT NOT NULL REFERENCES \"Project\"(\"id\") ON DELETE CASCADE,\
                \"contactId\" TEXT NOT NULL REFERENCES \"Contact\"(\"id\") ON DELETE CASCADE,\
                \"role\" TEXT,\
                \"addedAt\" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\
                PRIMARY KEY (\"projectId\", \"contactId\")\
            );",
        )?;
    }

    // Idempotent migration: add Action.projectId and Event.projectId if missing.
    let cols_to_add = [
        ("Action", "projectId", "TEXT REFERENCES \"Project\"(\"id\") ON DELETE SET NULL"),
        ("Event", "projectId", "TEXT REFERENCES \"Project\"(\"id\") ON DELETE SET NULL"),
    ];
    for (table, col, decl) in cols_to_add {
        let present: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info(?) WHERE name=?",
            rusqlite::params![table, col],
            |r| r.get(0),
        )?;
        if present == 0 {
            conn.execute(&format!("ALTER TABLE \"{table}\" ADD COLUMN \"{col}\" {decl}"), [])?;
        }
    }

    // archive (归档) feature — see docs/superpowers/specs/2026-07-04-archive-feature-design.md
    let archive_cols = [
        ("Action", "archivedAt", "TEXT"),
        ("Event", "archivedAt", "TEXT"),
        ("Project", "archivedAt", "TEXT"),
    ];
    for (table, col, decl) in archive_cols {
        let present: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info(?) WHERE name=?",
            rusqlite::params![table, col],
            |r| r.get(0),
        )?;
        if present == 0 {
            conn.execute(&format!("ALTER TABLE \"{table}\" ADD COLUMN \"{col}\" {decl}"), [])?;
        }
    }
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS \"Action_archivedAt_idx\" ON \"Action\"(\"archivedAt\");
         CREATE INDEX IF NOT EXISTS \"Event_archivedAt_idx\" ON \"Event\"(\"archivedAt\");
         CREATE INDEX IF NOT EXISTS \"Project_archivedAt_idx\" ON \"Project\"(\"archivedAt\");",
    )?;

    Ok(())
}

/// Seed a default local user if none exists.
///
/// Single-user MVP: we always need a `User` row with id `"local-default"`
/// so that FK constraints from Contact / Event / Tag / etc. resolve. The id
/// is a stable constant so the web-spa and Tauri both agree on the owner.
///
/// We check for the SPECIFIC id (not just `isLocal=1`) so that an older
/// install whose `User` table has a different local-user id does not
/// short-circuit seeding of the canonical id — otherwise the subsequent
/// `seed_default_tags` would fail with a FOREIGN KEY constraint error
/// when referencing `"local-default"`.
fn seed_default_user(conn: &Connection) -> Result<(), rusqlite::Error> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM \"User\" WHERE id = ?1 LIMIT 1",
            rusqlite::params!["local-default"],
            |row| row.get(0),
        )
        .ok();
    if existing.is_some() {
        return Ok(());
    }
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    conn.execute(
        "INSERT INTO \"User\" (id, name, email, isLocal, createdAt, updatedAt) \
         VALUES (?1, ?2, ?3, 1, ?4, ?4)",
        rusqlite::params!["local-default", "本地用户", "local@weavine.app", &now],
    )?;
    Ok(())
}

/// Seed a starter set of universal relationship tags if no tags exist yet.
fn seed_default_tags(conn: &Connection) -> Result<(), rusqlite::Error> {
    let existing: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM \"Tag\" WHERE \"ownerId\" = ?1",
            rusqlite::params!["local-default"],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if existing > 0 {
        return Ok(());
    }
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    let seeds: &[(&str, &str, &str)] = &[
        ("tag-seed-friend",    "朋友", "#10b981"),
        ("tag-seed-colleague", "同事", "#3b82f6"),
        ("tag-seed-classmate", "同学", "#f59e0b"),
        ("tag-seed-family",    "家人", "#ec4899"),
    ];
    let mut stmt = conn.prepare(
        "INSERT OR IGNORE INTO \"Tag\" (id, \"ownerId\", name, color, \"createdAt\") \
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    for (id, name, color) in seeds {
        stmt.execute(rusqlite::params![
            id,
            "local-default",
            name,
            color,
            &now,
        ])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_runs_idempotently() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();

        // First run
        run(&conn).unwrap();

        // Verify tables exist
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(
            tables.contains(&"User".to_string()),
            "User table not found: {tables:?}"
        );
        assert!(
            tables.contains(&"Contact".to_string()),
            "Contact table not found: {tables:?}"
        );
        assert!(
            tables.contains(&"Event".to_string()),
            "Event table not found: {tables:?}"
        );

        // Second run — must not error
        run(&conn).unwrap();
    }

    #[test]
    fn migration_allows_inserting_contact() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run(&conn).unwrap();

        // Insert a local user
        conn.execute(
            "INSERT INTO \"User\" (id, isLocal, createdAt, updatedAt) VALUES (?1, 1, ?2, ?2)",
            rusqlite::params!["test-user", "2025-01-01T00:00:00.000Z"],
        )
        .unwrap();

        // Insert a contact referencing that user
        conn.execute(
            "INSERT INTO Contact (id, ownerId, nickname, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, ?4)",
            rusqlite::params!["contact-1", "test-user", "Test", "2025-01-01T00:00:00.000Z"],
        )
        .unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM Contact", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn seed_default_tags_populates_fresh_database() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run(&conn).unwrap();

        let names: Vec<String> = conn
            .prepare("SELECT name FROM \"Tag\" WHERE \"ownerId\" = ?1 ORDER BY name")
            .unwrap()
            .query_map(rusqlite::params!["local-default"], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert_eq!(names, vec!["同事", "同学", "家人", "朋友"]);
    }

    #[test]
    fn seed_default_tags_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run(&conn).unwrap();
        let first: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM \"Tag\" WHERE \"ownerId\" = ?1",
                rusqlite::params!["local-default"],
                |row| row.get(0),
            )
            .unwrap();
        run(&conn).unwrap();
        let second: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM \"Tag\" WHERE \"ownerId\" = ?1",
                rusqlite::params!["local-default"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(first, 4);
        assert_eq!(second, 4);
    }

    #[test]
    fn seed_default_tags_preserves_user_created_tags() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run(&conn).unwrap();

        conn.execute(
            "INSERT INTO \"Tag\" (id, \"ownerId\", name, color, \"createdAt\") \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params!["user-tag-1", "local-default", "投资人", "#8b5cf6", "2026-07-01T00:00:00.000Z"],
        )
        .unwrap();

        run(&conn).unwrap();

        let total: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM \"Tag\" WHERE \"ownerId\" = ?1",
                rusqlite::params!["local-default"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(total, 5, "user-created tag must coexist with seeds");
    }

    #[test]
    fn seed_default_user_inserts_canonical_id_when_legacy_row_exists() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(SCHEMA_SQL).unwrap();

        // Legacy install: local user exists under a different id, no
        // default tags yet. The old `WHERE isLocal=1` check would have
        // found this row and skipped — so the canonical id was never
        // inserted, and the default-tag seed FK-fails.
        conn.execute(
            "INSERT INTO \"User\" (id, name, isLocal, createdAt, updatedAt) \
             VALUES (?1, ?2, 1, ?3, ?3)",
            rusqlite::params!["legacy-local", "Legacy", "2026-01-01T00:00:00.000Z"],
        )
        .unwrap();

        run(&conn).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM \"User\" WHERE id = ?1",
                rusqlite::params!["local-default"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "canonical id must be present after upgrade");

        let tag_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM \"Tag\" WHERE \"ownerId\" = ?1",
                rusqlite::params!["local-default"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tag_count, 4, "default tags must seed against canonical id");
    }
}
