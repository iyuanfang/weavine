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
    "email_verified" DATETIME,
    "image" TEXT,
    "wechat_union_id" TEXT,
    "openid_web" TEXT,
    "openid_mini" TEXT,
    "password_hash" TEXT,
    "is_local" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
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
    "session_token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "expires" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
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
    "reminder_enabled" INTEGER NOT NULL DEFAULT 1,
    "reminder_interval_days" INTEGER,
    "last_contacted_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "ContactTag" (
    "user_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL REFERENCES "Contact"("id") ON DELETE CASCADE,
    "tag_id" TEXT NOT NULL REFERENCES "Tag"("id") ON DELETE CASCADE,
    PRIMARY KEY ("contact_id", "tag_id")
);

CREATE TABLE IF NOT EXISTS "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "title" TEXT NOT NULL,
    "event_type" TEXT NOT NULL DEFAULT 'event',
    "start_at" DATETIME NOT NULL,
    "end_at" DATETIME,
    "location" TEXT,
    "notes" TEXT,
    "reminder_enabled" INTEGER NOT NULL DEFAULT 1,
    "reminder_at" DATETIME,
    "reminder_lead_minutes" INTEGER,
    "contact_id" TEXT REFERENCES "Contact"("id") ON DELETE SET NULL,
    "project_id" TEXT REFERENCES "Project"("id") ON DELETE SET NULL,
    "archived_at" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "Action" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'inbox',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT,
    "due_at" DATETIME,
    "contact_id" TEXT REFERENCES "Contact"("id") ON DELETE SET NULL,
    "completed_at" DATETIME,
    "project_id" TEXT REFERENCES "Project"("id") ON DELETE SET NULL,
    "archived_at" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "Interaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "contact_id" TEXT REFERENCES "Contact"("id") ON DELETE SET NULL,
    "action_id" TEXT REFERENCES "Action"("id") ON DELETE SET NULL,
    "event_id" TEXT REFERENCES "Event"("id") ON DELETE SET NULL,
    "occurred_at" DATETIME NOT NULL,
    "channel" TEXT,
    "summary" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Reminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "contact_id" TEXT REFERENCES "Contact"("id") ON DELETE CASCADE,
    "event_id" TEXT REFERENCES "Event"("id") ON DELETE CASCADE,
    "trigger_at" DATETIME NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'event',
    "dispatched" INTEGER NOT NULL DEFAULT 0,
    "dismissed" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Setting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "PushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "template" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "start_at" DATETIME,
    "due_at" DATETIME,
    "completed_at" DATETIME,
    "archived_at" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "ProjectContact" (
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
    "contact_id" TEXT NOT NULL REFERENCES "Contact"("id") ON DELETE CASCADE,
    "role" TEXT,
    "added_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("project_id", "contact_id")
);
"#;

const INDEX_SQL: &str = r#"
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "User_wechat_union_id_key" ON "User"("wechat_union_id");
CREATE UNIQUE INDEX IF NOT EXISTS "User_openid_web_key" ON "User"("openid_web");
CREATE UNIQUE INDEX IF NOT EXISTS "User_openid_mini_key" ON "User"("openid_mini");
CREATE INDEX IF NOT EXISTS "User_wechat_union_id_idx" ON "User"("wechat_union_id");
CREATE INDEX IF NOT EXISTS "Account_user_id_idx" ON "Account"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "Account_provider_provider_account_id_key" ON "Account"("provider", "provider_account_id");
CREATE UNIQUE INDEX IF NOT EXISTS "Session_session_token_key" ON "Session"("session_token");
CREATE INDEX IF NOT EXISTS "Session_user_id_idx" ON "Session"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "VerificationToken_token_key" ON "VerificationToken"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");
CREATE INDEX IF NOT EXISTS "Contact_user_id_nickname_idx" ON "Contact"("user_id", "nickname");
CREATE INDEX IF NOT EXISTS "Contact_user_id_name_idx" ON "Contact"("user_id", "name");
CREATE INDEX IF NOT EXISTS "Contact_user_id_company_idx" ON "Contact"("user_id", "company");
CREATE INDEX IF NOT EXISTS "Contact_user_id_city_idx" ON "Contact"("user_id", "city");
CREATE INDEX IF NOT EXISTS "Contact_user_id_importance_idx" ON "Contact"("user_id", "importance");
CREATE INDEX IF NOT EXISTS "Contact_user_id_reminder_enabled_last_contacted_at_idx" ON "Contact"("user_id", "reminder_enabled", "last_contacted_at");
CREATE INDEX IF NOT EXISTS "Contact_user_id_last_contacted_at_updated_at_idx" ON "Contact"("user_id", "last_contacted_at", "updated_at");
CREATE UNIQUE INDEX IF NOT EXISTS "Contact_user_id_email_key" ON "Contact"("user_id", "email");
CREATE UNIQUE INDEX IF NOT EXISTS "Tag_user_id_name_key" ON "Tag"("user_id", "name");
CREATE INDEX IF NOT EXISTS "ContactTag_user_id_idx" ON "ContactTag"("user_id");
CREATE INDEX IF NOT EXISTS "ContactTag_tag_id_idx" ON "ContactTag"("tag_id");
CREATE INDEX IF NOT EXISTS "Event_user_id_start_at_idx" ON "Event"("user_id", "start_at");
CREATE INDEX IF NOT EXISTS "Event_user_id_contact_id_idx" ON "Event"("user_id", "contact_id");
CREATE INDEX IF NOT EXISTS "Interaction_user_id_contact_id_occurred_at_idx" ON "Interaction"("user_id", "contact_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "Interaction_user_id_occurred_at_idx" ON "Interaction"("user_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "Action_user_id_status_due_at_idx" ON "Action"("user_id", "status", "due_at");
CREATE INDEX IF NOT EXISTS "Action_user_id_contact_id_idx" ON "Action"("user_id", "contact_id");
CREATE INDEX IF NOT EXISTS "Reminder_user_id_trigger_at_dispatched_dismissed_idx" ON "Reminder"("user_id", "trigger_at", "dispatched", "dismissed");
CREATE INDEX IF NOT EXISTS "Reminder_user_id_contact_id_idx" ON "Reminder"("user_id", "contact_id");
CREATE INDEX IF NOT EXISTS "Reminder_user_id_contact_id_kind_trigger_at_idx" ON "Reminder"("user_id", "contact_id", "kind", "trigger_at");
CREATE UNIQUE INDEX IF NOT EXISTS "Setting_user_id_key_key" ON "Setting"("user_id", "key");
CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_user_id_idx" ON "PushSubscription"("user_id");
CREATE INDEX IF NOT EXISTS "Project_user_id_template_idx" ON "Project"("user_id", "template");
CREATE INDEX IF NOT EXISTS "Project_user_id_stage_idx" ON "Project"("user_id", "stage");
CREATE INDEX IF NOT EXISTS "Action_user_id_project_id_idx" ON "Action"("user_id", "project_id");
CREATE INDEX IF NOT EXISTS "Event_user_id_project_id_idx" ON "Event"("user_id", "project_id");
CREATE INDEX IF NOT EXISTS "ProjectContact_user_id_idx" ON "ProjectContact"("user_id");
CREATE INDEX IF NOT EXISTS "ProjectContact_contact_id_idx" ON "ProjectContact"("contact_id");
CREATE INDEX IF NOT EXISTS "Contact_user_id_last_contacted_at_idx" ON "Contact"("user_id", "last_contacted_at DESC");
CREATE INDEX IF NOT EXISTS "Contact_user_id_created_at_idx" ON "Contact"("user_id", "created_at DESC");
CREATE INDEX IF NOT EXISTS "Contact_user_id_nickname_idx" ON "Contact"("user_id", "nickname COLLATE NOCASE ASC");
CREATE TABLE IF NOT EXISTS "UserAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserAccount_email_key" ON "UserAccount"("email");
CREATE TABLE IF NOT EXISTS "RefreshToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL REFERENCES "UserAccount"("id") ON DELETE CASCADE,
    "token_hash" TEXT NOT NULL,
    "device" TEXT,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" DATETIME
);
CREATE UNIQUE INDEX IF NOT EXISTS "RefreshToken_token_hash_key" ON "RefreshToken"("token_hash");
CREATE INDEX IF NOT EXISTS "RefreshToken_user_id_idx" ON "RefreshToken"("user_id");
"#;

/// Run all migrations (idempotent).
///
/// Creates tables and indexes if they do not already exist. Safe to call
/// on every startup.
pub fn run(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(SCHEMA_SQL)?;
    conn.execute_batch(INDEX_SQL)?;

    // ── Column name unification: camelCase → snake_case ─────────────
    // Detect existing databases that have old camelCase columns and
    // rebuild affected tables.  This runs ONCE; after the rebuild the
    // new DDL (above) matches the live schema.
    migrate_legacy_columns(conn)?;

    seed_default_user(conn)?;
    seed_default_tags(conn)?;

    // Idempotent migration: drop legacy Action.event_id column if present.
    let has_event_id: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('Action') WHERE name='event_id'",
        [],
        |r| r.get(0),
    )?;
    if has_event_id > 0 {
        conn.execute("DROP INDEX IF EXISTS \"Action_user_id_event_id_idx\"", [])?;
        conn.execute("ALTER TABLE \"Action\" DROP COLUMN \"event_id\"", [])?;
    }

    // Idempotent migration: add Event.reminder_lead_minutes if missing.
    let has_reminder_lead: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('Event') WHERE name='reminder_lead_minutes'",
        [],
        |r| r.get(0),
    )?;
    if has_reminder_lead == 0 {
        conn.execute(
            "ALTER TABLE \"Event\" ADD COLUMN \"reminder_lead_minutes\" INTEGER",
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
                \"user_id\" TEXT NOT NULL REFERENCES \"User\"(\"id\") ON DELETE CASCADE,\
                \"title\" TEXT NOT NULL,\
                \"description\" TEXT,\
                \"template\" TEXT NOT NULL,\
                \"stage\" TEXT NOT NULL,\
                \"start_at\" DATETIME,\
                \"due_at\" DATETIME,\
                \"completed_at\" DATETIME,\
                \"created_at\" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\
                \"updated_at\" DATETIME NOT NULL\
            );\
            CREATE TABLE IF NOT EXISTS \"ProjectContact\" (\
                \"user_id\" TEXT NOT NULL,\
                \"project_id\" TEXT NOT NULL REFERENCES \"Project\"(\"id\") ON DELETE CASCADE,\
                \"contact_id\" TEXT NOT NULL REFERENCES \"Contact\"(\"id\") ON DELETE CASCADE,\
                \"role\" TEXT,\
                \"added_at\" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\
                PRIMARY KEY (\"project_id\", \"contact_id\")\
            );",
        )?;
    }

    // Idempotent migration: add Action.project_id and Event.project_id if missing.
    let cols_to_add = [
        ("Action", "project_id", "TEXT REFERENCES \"Project\"(\"id\") ON DELETE SET NULL"),
        ("Event", "project_id", "TEXT REFERENCES \"Project\"(\"id\") ON DELETE SET NULL"),
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

    // archive (归档) feature – see docs/superpowers/specs/2026-07-04-archive-feature-design.md
    let archive_cols = [
        ("Action", "archived_at", "TEXT"),
        ("Event", "archived_at", "TEXT"),
        ("Project", "archived_at", "TEXT"),
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
        "CREATE INDEX IF NOT EXISTS \"Action_archived_at_idx\" ON \"Action\"(\"archived_at\");
         CREATE INDEX IF NOT EXISTS \"Event_archived_at_idx\" ON \"Event\"(\"archived_at\");
         CREATE INDEX IF NOT EXISTS \"Project_archived_at_idx\" ON \"Project\"(\"archived_at\");",
    )?;

    let stale_indexes: &[(&str, &str)] = &[
        ("Action_user_id_project_id_idx", "Action"),
        ("Event_user_id_project_id_idx", "Event"),
    ];
    for (idx_name, table) in stale_indexes {
        let present: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?",
            rusqlite::params![idx_name],
            |r| r.get(0),
        )?;
        if present > 0 {
            conn.execute(&format!("DROP INDEX \"{idx_name}\""), [])?;
            conn.execute(
                &format!(
                    "CREATE INDEX IF NOT EXISTS \"{idx_name}\" ON \"{table}\"(\"user_id\", \"project_id\")"
                ),
                [],
            )?;
        }
    }

    // Data migration: event_prep removed; map existing event_prep projects to general.
    // Stage mapping preserves data: 筹备中 → 待启动, 进行中 → 进行中, 已收尾 → 已完成.
    let event_prep_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM \"Project\" WHERE template = 'event_prep'",
        [],
        |r| r.get(0),
    )?;
    if event_prep_count > 0 {
        conn.execute_batch(
            "UPDATE \"Project\" SET template = 'general', stage = '待启动', updated_at = CURRENT_TIMESTAMP \
             WHERE template = 'event_prep' AND stage = '筹备中'; \
             UPDATE \"Project\" SET template = 'general', stage = '进行中', updated_at = CURRENT_TIMESTAMP \
             WHERE template = 'event_prep' AND stage = '进行中'; \
             UPDATE \"Project\" SET template = 'general', stage = '已完成', updated_at = CURRENT_TIMESTAMP \
             WHERE template = 'event_prep' AND stage = '已收尾';",
        )?;
    }

    // Data migration: general stage 计划 renamed to 待启动 (was renamed as part of
    // the 4-stage general template redesign: 待启动/进行中/待收尾/已完成).
    let legacy_general_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM \"Project\" WHERE template = 'general' AND stage = '计划'",
        [],
        |r| r.get(0),
    )?;
    if legacy_general_count > 0 {
        conn.execute(
            "UPDATE \"Project\" SET stage = '待启动', updated_at = CURRENT_TIMESTAMP \
             WHERE template = 'general' AND stage = '计划'",
            [],
        )?;
    }

    // SyncState table — key-value store for cloud sync configuration.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS \"SyncState\" (
            \"key\"   TEXT NOT NULL PRIMARY KEY,
            \"value\" TEXT NOT NULL
        );",
    )?;

    Ok(())
}

/// Migrate legacy camelCase columns to snake_case by rebuilding tables.
///
/// Detects old column names (e.g. `ownerId` in Contact) and recreates
/// the table with matching snake_case columns, copies data, drops the old
/// table, and renames.  Idempotent — only runs if old columns are detected.
fn migrate_legacy_columns(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Check sentinel: does Contact still have ownerId (old name)?
    let has_legacy: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('Contact') WHERE name='ownerId'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;
    if !has_legacy {
        return Ok(());
    }

    conn.execute_batch("PRAGMA foreign_keys=OFF; BEGIN TRANSACTION;")?;

    // Helper: rebuild a single table.
    // old_cols / new_cols — same-order column name pairs.
    // ddl            — full CREATE TABLE statement for the new (snake_case) table.
    macro_rules! rebuild {
        ($table:ident, $ddl:expr, [$($old:literal => $new:literal),+ $(,)?]) => {{
            let tmp = format!("{}__new", stringify!($table));
            conn.execute_batch(&format!("DROP TABLE IF EXISTS \"{tmp}\""))?;
            conn.execute_batch($ddl)?;
            let cols: Vec<&str> = vec![$($new),+];
            let old_cols: Vec<&str> = vec![$($old),+];
            let sel = old_cols.iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>().join(", ");
            let ins = cols.iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>().join(", ");
            conn.execute(
                &format!("INSERT INTO \"{tmp}\" ({ins}) SELECT {sel} FROM \"{}\"", stringify!($table)),
                [],
            )?;
            conn.execute_batch(&format!("DROP TABLE \"{}\"; ALTER TABLE \"{tmp}\" RENAME TO \"{}\"",
                stringify!($table), stringify!($table)))?;
        }};
    }

    // ── User ──
    rebuild!(User, r#"
        CREATE TABLE IF NOT EXISTS "User__new" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "name" TEXT, "email" TEXT, "email_verified" DATETIME, "image" TEXT,
            "wechat_union_id" TEXT, "openid_web" TEXT, "openid_mini" TEXT,
            "password_hash" TEXT, "is_local" INTEGER NOT NULL DEFAULT 0,
            "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" DATETIME NOT NULL
        );"#,
        ["id"=>"id", "name"=>"name", "email"=>"email", "emailVerified"=>"email_verified",
         "image"=>"image", "wechatUnionId"=>"wechat_union_id", "openidWeb"=>"openid_web",
         "openidMini"=>"openid_mini", "passwordHash"=>"password_hash",
         "isLocal"=>"is_local", "createdAt"=>"created_at", "updatedAt"=>"updated_at"]
    );

    // ── Account ──
    rebuild!(Account, r#"
        CREATE TABLE IF NOT EXISTS "Account__new" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
            "type" TEXT NOT NULL, "provider" TEXT NOT NULL,
            "provider_account_id" TEXT NOT NULL,
            "refresh_token" TEXT, "access_token" TEXT, "expires_at" INTEGER,
            "token_type" TEXT, "scope" TEXT, "id_token" TEXT, "session_state" TEXT
        );"#,
        ["id"=>"id", "userId"=>"user_id", "type"=>"type", "provider"=>"provider",
         "providerAccountId"=>"provider_account_id", "refresh_token"=>"refresh_token",
         "access_token"=>"access_token", "expires_at"=>"expires_at",
         "token_type"=>"token_type", "scope"=>"scope", "id_token"=>"id_token",
         "session_state"=>"session_state"]
    );

    // ── Session ──
    rebuild!(Session, r#"
        CREATE TABLE IF NOT EXISTS "Session__new" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "session_token" TEXT NOT NULL,
            "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
            "expires" DATETIME NOT NULL
        );"#,
        ["id"=>"id", "sessionToken"=>"session_token", "userId"=>"user_id", "expires"=>"expires"]
    );

    // ── Contact ──
    rebuild!(Contact, r#"
        CREATE TABLE IF NOT EXISTS "Contact__new" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
            "nickname" TEXT NOT NULL, "name" TEXT, "company" TEXT, "title" TEXT,
            "city" TEXT, "email" TEXT, "phone" TEXT, "wechat" TEXT, "notes" TEXT,
            "importance" TEXT NOT NULL DEFAULT 'normal',
            "reminder_enabled" INTEGER NOT NULL DEFAULT 1,
            "reminder_interval_days" INTEGER, "last_contacted_at" DATETIME,
            "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" DATETIME NOT NULL
        );"#,
        ["id"=>"id", "ownerId"=>"user_id", "nickname"=>"nickname", "name"=>"name",
         "company"=>"company", "title"=>"title", "city"=>"city", "email"=>"email",
         "phone"=>"phone", "wechat"=>"wechat", "notes"=>"notes", "importance"=>"importance",
         "reminderEnabled"=>"reminder_enabled", "reminderIntervalDays"=>"reminder_interval_days",
         "lastContactedAt"=>"last_contacted_at", "createdAt"=>"created_at", "updatedAt"=>"updated_at"]
    );

    // ── Tag ──
    rebuild!(Tag, r#"
        CREATE TABLE IF NOT EXISTS "Tag__new" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
            "name" TEXT NOT NULL, "color" TEXT,
            "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );"#,
        ["id"=>"id", "ownerId"=>"user_id", "name"=>"name", "color"=>"color",
         "createdAt"=>"created_at"]
    );

    // ── ContactTag ──
    rebuild!(ContactTag, r#"
        CREATE TABLE IF NOT EXISTS "ContactTag__new" (
            "user_id" TEXT NOT NULL,
            "contact_id" TEXT NOT NULL REFERENCES "Contact"("id") ON DELETE CASCADE,
            "tag_id" TEXT NOT NULL REFERENCES "Tag"("id") ON DELETE CASCADE,
            PRIMARY KEY ("contact_id", "tag_id")
        );"#,
        ["ownerId"=>"user_id", "contactId"=>"contact_id", "tagId"=>"tag_id"]
    );

    // ── Event ──
    rebuild!(Event, r#"
        CREATE TABLE IF NOT EXISTS "Event__new" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
            "title" TEXT NOT NULL, "event_type" TEXT NOT NULL DEFAULT 'event',
            "start_at" DATETIME NOT NULL, "end_at" DATETIME,
            "location" TEXT, "notes" TEXT,
            "reminder_enabled" INTEGER NOT NULL DEFAULT 1, "reminder_at" DATETIME,
            "reminder_lead_minutes" INTEGER,
            "contact_id" TEXT REFERENCES "Contact"("id") ON DELETE SET NULL,
            "project_id" TEXT REFERENCES "Project"("id") ON DELETE SET NULL,
            "archived_at" TEXT,
            "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" DATETIME NOT NULL
        );"#,
        ["id"=>"id", "ownerId"=>"user_id", "title"=>"title", "type"=>"event_type",
         "startAt"=>"start_at", "endAt"=>"end_at", "location"=>"location",
         "notes"=>"notes", "reminderEnabled"=>"reminder_enabled",
         "reminderAt"=>"reminder_at", "reminderLeadMinutes"=>"reminder_lead_minutes",
         "contactId"=>"contact_id", "projectId"=>"project_id",
         "archivedAt"=>"archived_at",
         "createdAt"=>"created_at", "updatedAt"=>"updated_at"]
    );

    // ── Action ──
    rebuild!(Action, r#"
        CREATE TABLE IF NOT EXISTS "Action__new" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
            "title" TEXT NOT NULL, "description" TEXT,
            "status" TEXT NOT NULL DEFAULT 'inbox', "priority" INTEGER NOT NULL DEFAULT 0,
            "category" TEXT, "due_at" DATETIME,
            "contact_id" TEXT REFERENCES "Contact"("id") ON DELETE SET NULL,
            "completed_at" DATETIME,
            "project_id" TEXT REFERENCES "Project"("id") ON DELETE SET NULL,
            "archived_at" TEXT,
            "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" DATETIME NOT NULL
        );"#,
        ["id"=>"id", "ownerId"=>"user_id", "title"=>"title", "description"=>"description",
         "status"=>"status", "priority"=>"priority", "category"=>"category",
         "dueAt"=>"due_at", "contactId"=>"contact_id", "completedAt"=>"completed_at",
         "projectId"=>"project_id", "archivedAt"=>"archived_at",
         "createdAt"=>"created_at", "updatedAt"=>"updated_at"]
    );

    // ── Interaction ──
    rebuild!(Interaction, r#"
        CREATE TABLE IF NOT EXISTS "Interaction__new" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
            "contact_id" TEXT REFERENCES "Contact"("id") ON DELETE SET NULL,
            "action_id" TEXT REFERENCES "Action"("id") ON DELETE SET NULL,
            "event_id" TEXT REFERENCES "Event"("id") ON DELETE SET NULL,
            "occurred_at" DATETIME NOT NULL, "channel" TEXT, "summary" TEXT NOT NULL,
            "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );"#,
        ["id"=>"id", "ownerId"=>"user_id", "contactId"=>"contact_id",
         "actionId"=>"action_id", "eventId"=>"event_id", "occurredAt"=>"occurred_at",
         "channel"=>"channel", "summary"=>"summary", "createdAt"=>"created_at"]
    );

    // ── Reminder ──
    rebuild!(Reminder, r#"
        CREATE TABLE IF NOT EXISTS "Reminder__new" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
            "contact_id" TEXT REFERENCES "Contact"("id") ON DELETE CASCADE,
            "event_id" TEXT REFERENCES "Event"("id") ON DELETE CASCADE,
            "trigger_at" DATETIME NOT NULL,
            "kind" TEXT NOT NULL DEFAULT 'event',
            "dispatched" INTEGER NOT NULL DEFAULT 0,
            "dismissed" INTEGER NOT NULL DEFAULT 0,
            "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );"#,
        ["id"=>"id", "ownerId"=>"user_id", "contactId"=>"contact_id",
         "eventId"=>"event_id", "triggerAt"=>"trigger_at", "kind"=>"kind",
         "dispatched"=>"dispatched", "dismissed"=>"dismissed", "createdAt"=>"created_at"]
    );

    // ── Setting ──
    rebuild!(Setting, r#"
        CREATE TABLE IF NOT EXISTS "Setting__new" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
            "key" TEXT NOT NULL, "value" TEXT NOT NULL,
            "updated_at" DATETIME NOT NULL
        );"#,
        ["id"=>"id", "ownerId"=>"user_id", "key"=>"key", "value"=>"value",
         "updatedAt"=>"updated_at"]
    );

    // ── PushSubscription ──
    rebuild!(PushSubscription, r#"
        CREATE TABLE IF NOT EXISTS "PushSubscription__new" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
            "endpoint" TEXT NOT NULL, "p256dh" TEXT NOT NULL, "auth" TEXT NOT NULL,
            "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );"#,
        ["id"=>"id", "ownerId"=>"user_id", "endpoint"=>"endpoint",
         "p256dh"=>"p256dh", "auth"=>"auth", "createdAt"=>"created_at"]
    );

    // ── Project ──
    rebuild!(Project, r#"
        CREATE TABLE IF NOT EXISTS "Project__new" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
            "title" TEXT NOT NULL, "description" TEXT,
            "template" TEXT NOT NULL, "stage" TEXT NOT NULL,
            "start_at" DATETIME, "due_at" DATETIME, "completed_at" DATETIME,
            "archived_at" TEXT,
            "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" DATETIME NOT NULL
        );"#,
        ["id"=>"id", "ownerId"=>"user_id", "title"=>"title", "description"=>"description",
         "template"=>"template", "stage"=>"stage", "startAt"=>"start_at",
         "dueAt"=>"due_at", "completedAt"=>"completed_at",
         "archivedAt"=>"archived_at",
         "createdAt"=>"created_at", "updatedAt"=>"updated_at"]
    );

    // ── ProjectContact ──
    rebuild!(ProjectContact, r#"
        CREATE TABLE IF NOT EXISTS "ProjectContact__new" (
            "user_id" TEXT NOT NULL,
            "project_id" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
            "contact_id" TEXT NOT NULL REFERENCES "Contact"("id") ON DELETE CASCADE,
            "role" TEXT,
            "added_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY ("project_id", "contact_id")
        );"#,
        ["ownerId"=>"user_id", "projectId"=>"project_id", "contactId"=>"contact_id",
         "role"=>"role", "addedAt"=>"added_at"]
    );

    // ── UserAccount ──
    rebuild!(UserAccount, r#"
        CREATE TABLE IF NOT EXISTS "UserAccount__new" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "email" TEXT NOT NULL,
            "password_hash" TEXT NOT NULL,
            "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );"#,
        ["id"=>"id", "email"=>"email", "passwordHash"=>"password_hash",
         "createdAt"=>"created_at", "updatedAt"=>"updated_at"]
    );

    // ── RefreshToken ──
    rebuild!(RefreshToken, r#"
        CREATE TABLE IF NOT EXISTS "RefreshToken__new" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "user_id" TEXT NOT NULL REFERENCES "UserAccount"("id") ON DELETE CASCADE,
            "token_hash" TEXT NOT NULL, "device" TEXT,
            "expires_at" DATETIME NOT NULL,
            "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "revoked_at" DATETIME
        );"#,
        ["id"=>"id", "userId"=>"user_id", "tokenHash"=>"token_hash",
         "device"=>"device", "expiresAt"=>"expires_at",
         "createdAt"=>"created_at", "revokedAt"=>"revoked_at"]
    );

    conn.execute_batch("COMMIT; PRAGMA foreign_keys=ON;")?;
    Ok(())
}

/// Seed a default local user if none exists.
///
/// Single-user MVP: we always need a `User` row with id `"local-default"`
/// so that FK constraints from Contact / Event / Tag / etc. resolve. The id
/// is a stable constant so the web-spa and Tauri both agree on the owner.
///
/// We check for the SPECIFIC id (not just `is_local=1`) so that an older
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
        "INSERT INTO \"User\" (id, name, email, is_local, created_at, updated_at) \
         VALUES (?1, ?2, ?3, 1, ?4, ?4)",
        rusqlite::params!["local-default", "本地用户", "local@weavine.app", &now],
    )?;
    Ok(())
}

/// Seed a starter set of universal relationship tags if no tags exist yet.
fn seed_default_tags(conn: &Connection) -> Result<(), rusqlite::Error> {
    let existing: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM \"Tag\" WHERE \"user_id\" = ?1",
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
        "INSERT OR IGNORE INTO \"Tag\" (id, \"user_id\", name, color, \"created_at\") \
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
            "INSERT INTO \"User\" (id, is_local, created_at, updated_at) VALUES (?1, 1, ?2, ?2)",
            rusqlite::params!["test-user", "2025-01-01T00:00:00.000Z"],
        )
        .unwrap();

        // Insert a contact referencing that user
        conn.execute(
            "INSERT INTO Contact (id, user_id, nickname, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
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
            .prepare("SELECT name FROM \"Tag\" WHERE \"user_id\" = ?1 ORDER BY name")
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
                "SELECT COUNT(*) FROM \"Tag\" WHERE \"user_id\" = ?1",
                rusqlite::params!["local-default"],
                |row| row.get(0),
            )
            .unwrap();
        run(&conn).unwrap();
        let second: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM \"Tag\" WHERE \"user_id\" = ?1",
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
            "INSERT INTO \"Tag\" (id, \"user_id\", name, color, \"created_at\") \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params!["user-tag-1", "local-default", "投资人", "#8b5cf6", "2026-07-01T00:00:00.000Z"],
        )
        .unwrap();

        run(&conn).unwrap();

        let total: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM \"Tag\" WHERE \"user_id\" = ?1",
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
            "INSERT INTO \"User\" (id, name, is_local, created_at, updated_at) \
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
                "SELECT COUNT(*) FROM \"Tag\" WHERE \"user_id\" = ?1",
                rusqlite::params!["local-default"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tag_count, 4, "default tags must seed against canonical id");
    }
}
