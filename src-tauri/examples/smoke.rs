use rusqlite::{params, Connection};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let conn = Connection::open_in_memory()?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    println!("--- Step 1: Apply embedded schema ---");
    apply_schema(&conn)?;
    println!("  applied");

    println!("\n--- Step 2: Verify all expected tables exist ---");
    let expected = [
        "User", "Account", "Session", "VerificationToken",
        "Contact", "Tag", "ContactTag",
        "Event", "Action", "Interaction", "Reminder",
        "Setting", "PushSubscription",
    ];
    let present: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")?
        .query_map([], |r| r.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    for t in &expected {
        let found = present.contains(&t.to_string());
        println!("  {} {}", if found { "✓" } else { "✗" }, t);
        if !found { return Err(format!("table {} missing", t).into()); }
    }

    println!("\n--- Step 3: Seed local user ---");
    conn.execute(
        "INSERT INTO \"User\" (id, name, email, isLocal, createdAt, updatedAt) \
         VALUES ('user-local-1', 'Local User', 'local@prm.local', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        [],
    )?;
    let user_count: i64 = conn.query_row("SELECT COUNT(*) FROM User", [], |r| r.get(0))?;
    println!("  user count: {}", user_count);

    println!("\n--- Step 4: Insert + query like create_contact does ---");
    let id = "contact-test-1";
    conn.execute(
        "INSERT INTO Contact \
         (id, ownerId, nickname, importance, reminderEnabled, createdAt, updatedAt) \
         VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        params![id, "user-local-1", "张三", "normal", 1i64],
    )?;

    let row: (String, String, String) = conn.query_row(
        "SELECT id, ownerId, nickname FROM Contact WHERE id = ?1",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    println!("  inserted: {:?}", row);
    assert_eq!(row.0, id);
    assert_eq!(row.2, "张三");

    println!("\n--- Step 5: Verify all Contact columns exist as commands expect ---");
    let expected_contact_cols = [
        "id", "ownerId", "nickname", "name", "company", "title",
        "city", "email", "phone", "wechat", "notes", "importance",
        "reminderEnabled", "reminderIntervalDays", "lastContactedAt",
        "createdAt", "updatedAt",
    ];
    let contact_cols: Vec<String> = conn
        .prepare("PRAGMA table_info(Contact)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();
    for c in &expected_contact_cols {
        let found = contact_cols.contains(&c.to_string());
        println!("  {} {}", if found { "✓" } else { "✗" }, c);
        if !found { return Err(format!("Contact column {} missing", c).into()); }
    }

    println!("\nPhase 0 PASSED: schema matches what Rust commands expect.");
    Ok(())
}

fn apply_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA_SQL)
}

const SCHEMA_SQL: &str = include_str!("schema_smoke.sql");
