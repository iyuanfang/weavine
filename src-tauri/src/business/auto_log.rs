use rusqlite::{params, Connection};
use uuid::Uuid;

const SEVEN_DAYS_SECS: i64 = 7 * 86_400;

struct EndedEvent {
    id: String,
    user_id: String,
    title: String,
    end_at: String,
}

/// Idempotent: re-running does not duplicate rows because of
/// `idx_interaction_source_ref_contact`.
pub fn run(conn: &Connection, window_secs: i64) -> rusqlite::Result<usize> {
    let candidates = fetch_promptable_events(conn, window_secs)?;
    let mut written = 0usize;
    for ev in &candidates {
        written += write_interactions_for_event(conn, ev)?;
    }
    Ok(written)
}

fn fetch_promptable_events(conn: &Connection, window_secs: i64) -> rusqlite::Result<Vec<EndedEvent>> {
    let mut stmt = conn.prepare(
        "SELECT e.id, e.user_id, e.title, e.end_at \
         FROM \"Event\" e \
         WHERE e.archived_at IS NULL \
           AND e.end_at IS NOT NULL \
           AND julianday(e.end_at) >= julianday('now') - (?1 / 86400.0) \
           AND julianday(e.end_at) <  julianday('now') \
           AND EXISTS ( \
               SELECT 1 FROM EntityLink el \
               WHERE el.user_id = e.user_id \
                 AND el.from_type = 'event' \
                 AND el.from_id = e.id \
                 AND el.relation_type = 'participated' \
           ) \
         ORDER BY e.end_at ASC",
    )?;
    let rows = stmt.query_map(params![window_secs], |r| {
        Ok(EndedEvent {
            id: r.get(0)?,
            user_id: r.get(1)?,
            title: r.get(2)?,
            end_at: r.get(3)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn write_interactions_for_event(conn: &Connection, ev: &EndedEvent) -> rusqlite::Result<usize> {
    let participants: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT el.to_id FROM EntityLink el \
             WHERE el.user_id = ?1 \
               AND el.from_type = 'event' \
               AND el.from_id = ?2 \
               AND el.relation_type = 'participated'",
        )?;
        let rows = stmt.query_map(params![&ev.user_id, &ev.id], |r| r.get::<_, String>(0))?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let mut written = 0usize;
    let tx = conn.unchecked_transaction()?;
    for contact_id in &participants {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now()
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string();
        let inserted = tx.execute(
            "INSERT INTO Interaction \
                (id, user_id, contact_id, event_id, occurred_at, summary, source, source_ref, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'event', ?4, ?7) \
             ON CONFLICT DO NOTHING",
            params![&id, &ev.user_id, contact_id, &ev.id, &ev.end_at, &ev.title, &now],
        )?;
        if inserted == 0 {
            continue;
        }
        written += 1;
        tx.execute(
            "UPDATE Contact SET last_interaction_at = ?1 \
             WHERE id = ?2 AND user_id = ?3 AND (last_interaction_at IS NULL OR last_interaction_at < ?1)",
            params![&ev.end_at, contact_id, &ev.user_id],
        )?;
        if let Err(e) = crate::business::keep_in_touch::schedule_for_contact_tx(&tx, contact_id) {
            eprintln!(
                "[auto_log::write_interactions] keep_in_touch re-schedule for {contact_id} failed: {e}"
            );
        }
    }
    tx.commit()?;
    Ok(written)
}

pub fn run_with_default_window(conn: &Connection) -> rusqlite::Result<usize> {
    run(conn, SEVEN_DAYS_SECS)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::migration::run(&conn).unwrap();
        conn
    }

    fn make_user(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO \"User\" (id, name, email, created_at, updated_at) \
             VALUES (?1, ?1, ?1 || '@x', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            params![id],
        )
        .unwrap();
    }

    fn make_contact(conn: &Connection, id: &str, user_id: &str) {
        conn.execute(
            "INSERT INTO \"Contact\" (id, user_id, nickname, last_interaction_at, created_at, updated_at) \
             VALUES (?1, ?2, ?1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
            params![id, user_id],
        )
        .unwrap();
    }

    fn make_event(conn: &Connection, id: &str, user_id: &str, end_at: &str) {
        conn.execute(
            "INSERT INTO \"Event\" (id, user_id, title, event_type, start_at, end_at, created_at, updated_at) \
             VALUES (?1, ?2, 'meet', 'event', ?3, ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            params![id, user_id, end_at, end_at],
        )
        .unwrap();
    }

    fn add_participant(conn: &Connection, event_id: &str, user_id: &str, contact_id: &str) {
        conn.execute(
            "INSERT INTO EntityLink \
                (id, user_id, from_type, from_id, to_type, to_id, relation_type, role) \
             VALUES (?1, ?2, 'event', ?3, 'contact', ?4, 'participated', 'participant')",
            params![Uuid::new_v4().to_string(), user_id, event_id, contact_id],
        )
        .unwrap();
    }

    #[test]
    fn writes_one_interaction_per_participant() {
        let conn = fresh_db();
        make_user(&conn, "u1");
        make_contact(&conn, "c1", "u1");
        make_contact(&conn, "c2", "u1");
        make_event(&conn, "e1", "u1", "2026-08-20T10:00:00.000Z");
        add_participant(&conn, "e1", "u1", "c1");
        add_participant(&conn, "e1", "u1", "c2");

        let n = run(&conn, 7 * 86_400).unwrap();
        assert_eq!(n, 2);

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM Interaction WHERE source = 'event'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn idempotent_when_rerun() {
        let conn = fresh_db();
        make_user(&conn, "u1");
        make_contact(&conn, "c1", "u1");
        make_event(&conn, "e1", "u1", "2026-08-20T10:00:00.000Z");
        add_participant(&conn, "e1", "u1", "c1");

        assert_eq!(run(&conn, 7 * 86_400).unwrap(), 1);
        assert_eq!(run(&conn, 7 * 86_400).unwrap(), 0);
    }

    #[test]
    fn skips_archived_event() {
        let conn = fresh_db();
        make_user(&conn, "u1");
        make_contact(&conn, "c1", "u1");
        make_event(&conn, "e1", "u1", "2026-08-20T10:00:00.000Z");
        add_participant(&conn, "e1", "u1", "c1");
        conn.execute(
            "UPDATE \"Event\" SET archived_at = CURRENT_TIMESTAMP WHERE id = 'e1'",
            [],
        )
        .unwrap();

        assert_eq!(run(&conn, 7 * 86_400).unwrap(), 0);
    }

    #[test]
    fn skips_event_with_no_participants() {
        let conn = fresh_db();
        make_user(&conn, "u1");
        make_contact(&conn, "c1", "u1");
        make_event(&conn, "e1", "u1", "2026-08-20T10:00:00.000Z");

        assert_eq!(run(&conn, 7 * 86_400).unwrap(), 0);
    }

    #[test]
    fn skips_event_outside_window() {
        let conn = fresh_db();
        make_user(&conn, "u1");
        make_contact(&conn, "c1", "u1");
        make_event(&conn, "e1", "u1", "2026-01-01T10:00:00.000Z");
        add_participant(&conn, "e1", "u1", "c1");

        assert_eq!(run(&conn, 7 * 86_400).unwrap(), 0);
    }

    #[test]
    fn bumps_last_interaction_at() {
        let conn = fresh_db();
        make_user(&conn, "u1");
        make_contact(&conn, "c1", "u1");
        make_event(&conn, "e1", "u1", "2026-08-20T10:00:00.000Z");
        add_participant(&conn, "e1", "u1", "c1");

        run(&conn, 7 * 86_400).unwrap();
        let last: String = conn
            .query_row(
                "SELECT last_interaction_at FROM Contact WHERE id = 'c1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(last.starts_with("2026-08-20T10:00:00"));
    }
}