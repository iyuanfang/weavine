use rusqlite::{Connection, Result};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new() -> Result<Self> {
        let db_path = get_db_path();
        let conn = Connection::open(&db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        let db = Database {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS User (
                id TEXT PRIMARY KEY,
                name TEXT,
                email TEXT UNIQUE,
                emailVerified TEXT,
                image TEXT,
                passwordHash TEXT,
                isLocal INTEGER NOT NULL DEFAULT 0,
                createdAt TEXT NOT NULL DEFAULT (datetime('now')),
                updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS Contact (
                id TEXT PRIMARY KEY,
                ownerId TEXT NOT NULL,
                nickname TEXT NOT NULL,
                name TEXT,
                company TEXT,
                title TEXT,
                city TEXT,
                email TEXT,
                phone TEXT,
                wechat TEXT,
                notes TEXT,
                importance TEXT NOT NULL DEFAULT 'normal',
                reminderEnabled INTEGER NOT NULL DEFAULT 1,
                reminderIntervalDays INTEGER,
                lastContactedAt TEXT,
                createdAt TEXT NOT NULL DEFAULT (datetime('now')),
                updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (ownerId) REFERENCES User(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS Tag (
                id TEXT PRIMARY KEY,
                ownerId TEXT NOT NULL,
                name TEXT NOT NULL,
                color TEXT,
                createdAt TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (ownerId) REFERENCES User(id) ON DELETE CASCADE,
                UNIQUE(ownerId, name)
            );

            CREATE TABLE IF NOT EXISTS ContactTag (
                ownerId TEXT NOT NULL,
                contactId TEXT NOT NULL,
                tagId TEXT NOT NULL,
                PRIMARY KEY (contactId, tagId),
                FOREIGN KEY (ownerId) REFERENCES User(id) ON DELETE CASCADE,
                FOREIGN KEY (contactId) REFERENCES Contact(id) ON DELETE CASCADE,
                FOREIGN KEY (tagId) REFERENCES Tag(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS Event (
                id TEXT PRIMARY KEY,
                ownerId TEXT NOT NULL,
                title TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT '会面',
                startAt TEXT NOT NULL,
                endAt TEXT,
                location TEXT,
                notes TEXT,
                contactId TEXT,
                createdAt TEXT NOT NULL DEFAULT (datetime('now')),
                updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (ownerId) REFERENCES User(id) ON DELETE CASCADE,
                FOREIGN KEY (contactId) REFERENCES Contact(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS Action (
                id TEXT PRIMARY KEY,
                ownerId TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'inbox',
                priority INTEGER NOT NULL DEFAULT 0,
                category TEXT,
                dueAt TEXT,
                contactId TEXT,
                eventId TEXT,
                completedAt TEXT,
                createdAt TEXT NOT NULL DEFAULT (datetime('now')),
                updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (ownerId) REFERENCES User(id) ON DELETE CASCADE,
                FOREIGN KEY (contactId) REFERENCES Contact(id) ON DELETE SET NULL,
                FOREIGN KEY (eventId) REFERENCES Event(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS Interaction (
                id TEXT PRIMARY KEY,
                ownerId TEXT NOT NULL,
                contactId TEXT,
                actionId TEXT,
                eventId TEXT,
                occurredAt TEXT NOT NULL,
                channel TEXT,
                summary TEXT NOT NULL,
                createdAt TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (ownerId) REFERENCES User(id) ON DELETE CASCADE,
                FOREIGN KEY (contactId) REFERENCES Contact(id) ON DELETE SET NULL,
                FOREIGN KEY (actionId) REFERENCES Action(id) ON DELETE SET NULL,
                FOREIGN KEY (eventId) REFERENCES Event(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS Reminder (
                id TEXT PRIMARY KEY,
                ownerId TEXT NOT NULL,
                contactId TEXT,
                eventId TEXT,
                triggerAt TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'event',
                dispatched INTEGER NOT NULL DEFAULT 0,
                dismissed INTEGER NOT NULL DEFAULT 0,
                createdAt TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (ownerId) REFERENCES User(id) ON DELETE CASCADE,
                FOREIGN KEY (contactId) REFERENCES Contact(id) ON DELETE CASCADE,
                FOREIGN KEY (eventId) REFERENCES Event(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS Setting (
                id TEXT PRIMARY KEY,
                ownerId TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (ownerId) REFERENCES User(id) ON DELETE CASCADE,
                UNIQUE(ownerId, key)
            );

            CREATE INDEX IF NOT EXISTS idx_contact_owner ON Contact(ownerId);
            CREATE INDEX IF NOT EXISTS idx_event_owner ON Event(ownerId);
            CREATE INDEX IF NOT EXISTS idx_event_start ON Event(ownerId, startAt);
            CREATE INDEX IF NOT EXISTS idx_interaction_owner ON Interaction(ownerId);
            CREATE INDEX IF NOT EXISTS idx_interaction_occurred ON Interaction(ownerId, occurredAt);
            CREATE INDEX IF NOT EXISTS idx_action_owner ON Action(ownerId);
            CREATE INDEX IF NOT EXISTS idx_action_status ON Action(ownerId, status, dueAt);
            CREATE INDEX IF NOT EXISTS idx_reminder_trigger ON Reminder(ownerId, triggerAt, dispatched, dismissed);
            CREATE INDEX IF NOT EXISTS idx_tag_owner ON Tag(ownerId);
        ",
        )?;
        Ok(())
    }
}

fn get_db_path() -> PathBuf {
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("weavine");
    std::fs::create_dir_all(&data_dir).ok();
    data_dir.join("dev.db")
}
