use crate::business;
use crate::db::Database;
use crate::models::{Contact, ListContactsParams};
use crate::quick::{self, QuickItem};
use chrono::Utc;
use tauri::State;

#[tauri::command(rename_all = "snake_case")]
pub fn quick_parse(
    db: State<Database>,
    user_id: String,
    text: String,
    contact_names: Vec<String>,
) -> Result<QuickItem, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut contacts = Vec::new();
    if !contact_names.is_empty() {
        let p = ListContactsParams {
            user_id,
            tag_id: None,
            search: None,
            importance: None,
            sort_by: "created_at".into(),
            limit: 50,
            cursor: None,
        };
        contacts = business::contact::list(&conn, &p)
            .map(|(items, _)| items)
            .unwrap_or_default();
    }

    Ok(quick::parse(&text, &contacts, Utc::now()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migration;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migration::run(&conn).unwrap();
        conn
    }

    fn seed_contact(conn: &Connection, id: &str, nickname: &str) {
        conn.execute(
            "INSERT INTO Contact (id, user_id, nickname, name, importance, last_interaction_at, created_at, updated_at) \
             VALUES (?1, 'local-default', ?2, ?2, 'low', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
            rusqlite::params![id, nickname],
        )
        .unwrap();
    }

    fn fetch_all(conn: &Connection, user_id: &str) -> Vec<Contact> {
        let p = ListContactsParams {
            user_id: user_id.into(),
            tag_id: None,
            search: None,
            importance: None,
            sort_by: "created_at".into(),
            limit: 50,
            cursor: None,
        };
        business::contact::list(conn, &p).unwrap().0
    }

    #[test]
    fn post_fix_links_contact_when_text_mentions_nickname() {
        let conn = setup();
        seed_contact(&conn, "zhang-id", "张三");
        seed_contact(&conn, "li-id", "李四");
        let contacts = business::contact::list(
            &conn,
            &ListContactsParams {
                user_id: "local-default".into(),
                tag_id: None,
                search: None,
                importance: None,
                sort_by: "created_at".into(),
                limit: 50,
                cursor: None,
            },
        )
        .unwrap()
        .0;
        let item = quick::parse("明天下午3点和张三开会", &contacts, Utc::now());
        assert_eq!(item.contact_id.as_deref(), Some("zhang-id"));
        assert!(item.contact_match_score > 0.0);
    }

    #[test]
    fn old_search_filter_returned_empty_due_to_joined_names() {
        let conn = setup();
        seed_contact(&conn, "zhang-id", "张三");
        let contacts = business::contact::list(
            &conn,
            &ListContactsParams {
                user_id: "local-default".into(),
                tag_id: None,
                search: Some("张三 李四 王五".into()),
                importance: None,
                sort_by: "created_at".into(),
                limit: 50,
                cursor: None,
            },
        )
        .unwrap()
        .0;
        assert!(
            contacts.is_empty(),
            "LIKE '%张三 李四 王五%' must never match a single-name row"
        );
        let unfiltered = fetch_all(&conn, "local-default");
        assert!(!unfiltered.is_empty(), "with search=None, contacts must be returned");
    }
}