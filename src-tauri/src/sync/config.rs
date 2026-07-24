use rusqlite::Connection;

/// Keys for the `SyncState` key-value table.
pub const KEY_SERVER_URL: &str = "server_url";
pub const KEY_ACCESS_TOKEN: &str = "access_token";
pub const KEY_REFRESH_TOKEN: &str = "refresh_token";
pub const KEY_DEVICE_ID: &str = "device_id";
pub const KEY_USER_ID: &str = "user_id";
pub const KEY_USER_EMAIL: &str = "user_email";
pub const KEY_LAST_PULLED_REVISION: &str = "last_pulled_revision";
pub const KEY_LAST_PUSHED_REVISION: &str = "last_pushed_revision";

/// Read a string value from SyncState.
pub fn get(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM SyncState WHERE key = ?1")?;
    let mut rows = stmt.query_map([key], |row| row.get::<_, String>(0))?;
    match rows.next() {
        Some(Ok(v)) => Ok(Some(v)),
        _ => Ok(None),
    }
}

/// Write a string value to SyncState (upsert).
pub fn set(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO SyncState (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

/// Delete a key from SyncState.
pub fn delete(conn: &Connection, key: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM SyncState WHERE key = ?1", [key])?;
    Ok(())
}

/// Check whether the desktop has been linked to a cloud account.
pub fn is_linked(conn: &Connection) -> rusqlite::Result<bool> {
    Ok(get(conn, KEY_SERVER_URL)?.is_some() && get(conn, KEY_ACCESS_TOKEN)?.is_some())
}

/// Clear all sync state (unlink).
pub fn clear_all(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM SyncState", [])?;
    Ok(())
}

/// Read last pulled revision (default 0).
pub fn last_pulled_revision(conn: &Connection) -> rusqlite::Result<i64> {
    match get(conn, KEY_LAST_PULLED_REVISION)? {
        Some(v) => v.parse::<i64>().or(Ok(0)),
        None => Ok(0),
    }
}

/// Read last pushed revision (default 0).
pub fn last_pushed_revision(conn: &Connection) -> rusqlite::Result<i64> {
    match get(conn, KEY_LAST_PUSHED_REVISION)? {
        Some(v) => v.parse::<i64>().or(Ok(0)),
        None => Ok(0),
    }
}
