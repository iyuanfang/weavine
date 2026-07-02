/// Embedded schema migration for weavine.
///
/// Runs the Prisma-generated DDL against a rusqlite Connection using
/// `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` so the
/// function is idempotent (safe to call on every startup).
///
/// The SQL is sourced from `prisma/migrations/20260701061802_init/migration.sql`
/// (the SQLite Prisma migration).
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
    "eventId" TEXT REFERENCES "Event"("id") ON DELETE SET NULL,
    "completedAt" DATETIME,
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
CREATE INDEX IF NOT EXISTS "Action_ownerId_eventId_idx" ON "Action"("ownerId", "eventId");
CREATE INDEX IF NOT EXISTS "Reminder_ownerId_triggerAt_dispatched_dismissed_idx" ON "Reminder"("ownerId", "triggerAt", "dispatched", "dismissed");
CREATE INDEX IF NOT EXISTS "Reminder_ownerId_contactId_idx" ON "Reminder"("ownerId", "contactId");
CREATE INDEX IF NOT EXISTS "Reminder_ownerId_contactId_kind_triggerAt_idx" ON "Reminder"("ownerId", "contactId", "kind", "triggerAt");
CREATE UNIQUE INDEX IF NOT EXISTS "Setting_ownerId_key_key" ON "Setting"("ownerId", "key");
CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_ownerId_idx" ON "PushSubscription"("ownerId");
"#;

/// Run all migrations (idempotent).
///
/// Creates tables and indexes if they do not already exist. Safe to call
/// on every startup.
pub fn run(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(SCHEMA_SQL)?;
    conn.execute_batch(INDEX_SQL)?;
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
}
