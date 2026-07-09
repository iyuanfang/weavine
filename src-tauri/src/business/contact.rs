use crate::models::*;
use rusqlite::Connection;
use uuid::Uuid;

pub(crate) fn row_to_contact(row: &rusqlite::Row) -> rusqlite::Result<Contact> {
    Ok(Contact {
        id: row.get(0)?,
        user_id: row.get(1)?,
        nickname: row.get(2)?,
        name: row.get(3)?,
        company: row.get(4)?,
        title: row.get(5)?,
        city: row.get(6)?,
        email: row.get(7)?,
        phone: row.get(8)?,
        wechat: row.get(9)?,
        notes: row.get(10)?,
        importance: row.get(11)?,
        reminder_enabled: row.get::<_, i64>(12)? != 0,
        reminder_interval_days: row.get(13)?,
        last_contacted_at: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
        tags: Vec::new(),
    })
}

/// Load all Tag rows attached to a single contact (joined via ContactTag).
pub(crate) fn load_tags_for_contact(
    conn: &Connection,
    contact_id: &str,
) -> rusqlite::Result<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.user_id, t.name, t.color, t.created_at \
         FROM Tag t INNER JOIN ContactTag ct ON ct.tag_id = t.id \
         WHERE ct.contact_id = ?1 \
         ORDER BY t.name ASC",
    )?;
    let rows = stmt
        .query_map([contact_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                user_id: row.get(1)?,
                name: row.get(2)?,
                color: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub(crate) fn hydrate_tags(
    conn: &Connection,
    mut contacts: Vec<Contact>,
) -> rusqlite::Result<Vec<Contact>> {
    for c in contacts.iter_mut() {
        c.tags = load_tags_for_contact(conn, &c.id)?;
    }
    Ok(contacts)
}

pub fn list(conn: &Connection, p: &ListContactsParams) -> rusqlite::Result<(Vec<Contact>, i64)> {
    let mut sql = String::from("SELECT * FROM Contact WHERE user_id = ?1");
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> =
        vec![Box::new(p.user_id.clone())];
    let mut idx = 2;

    if let Some(ref search) = p.search {
        if !search.is_empty() {
            sql.push_str(&format!(
                " AND (nickname LIKE ?{0} OR name LIKE ?{0} OR company LIKE ?{0})",
                idx
            ));
            param_values.push(Box::new(format!("%{}%", search)));
            idx += 1;
        }
    }

    if let Some(ref importance) = p.importance {
        sql.push_str(&format!(" AND importance = ?{}", idx));
        param_values.push(Box::new(importance.clone()));
        idx += 1;
    }

    if let Some(ref tag_id) = p.tag_id {
        sql.push_str(&format!(
            " AND id IN (SELECT contact_id FROM ContactTag WHERE tag_id = ?{})",
            idx
        ));
        param_values.push(Box::new(tag_id.clone()));
    }

    // Sort: look up in whitelist; fall back to updated_at DESC for unknown keys
    let order_by = CONTACT_SORT_WHITELIST
        .iter()
        .find(|(key, _)| *key == p.sort_by)
        .map(|(_, order)| *order)
        .unwrap_or("updated_at DESC, id ASC");
    sql.push_str(&format!(" ORDER BY {}", order_by));

    // Clamp limit and offset
    let limit = if p.limit <= 0 {
        DEFAULT_CONTACT_LIMIT
    } else if p.limit > MAX_CONTACT_LIMIT {
        MAX_CONTACT_LIMIT
    } else {
        p.limit
    };
    let offset = if p.offset < 0 { 0 } else { p.offset };

    sql.push_str(" LIMIT ? OFFSET ?");
    param_values.push(Box::new(limit));
    param_values.push(Box::new(offset));

    let mut stmt = conn.prepare(&sql)?;
    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|b| b.as_ref()).collect();

    let contacts: Vec<Contact> = stmt
        .query_map(params_refs.as_slice(), row_to_contact)?
        .filter_map(|r| r.ok())
        .collect();

    // Total count query (same WHERE, no ORDER BY / LIMIT / OFFSET)
    let count_sql = {
        // Rebuild WHERE clause for COUNT
        let mut csql = String::from("SELECT COUNT(*) FROM Contact WHERE user_id = ?1");
        let mut cidx = 2;
        if let Some(ref search) = p.search {
            if !search.is_empty() {
                csql.push_str(&format!(
                    " AND (nickname LIKE ?{0} OR name LIKE ?{0} OR company LIKE ?{0})",
                    cidx
                ));
                cidx += 1;
            }
        }
        if let Some(ref _importance) = p.importance {
            csql.push_str(&format!(" AND importance = ?{}", cidx));
            cidx += 1;
        }
        if let Some(ref _tag_id) = p.tag_id {
            csql.push_str(&format!(
                " AND id IN (SELECT contact_id FROM ContactTag WHERE tag_id = ?{})",
                cidx
            ));
        }
        csql
    };

    let total: i64 = {
        let mut count_params: Vec<Box<dyn rusqlite::types::ToSql>> =
            vec![Box::new(p.user_id.clone())];
        if let Some(ref search) = p.search {
            if !search.is_empty() {
                count_params.push(Box::new(format!("%{}%", search)));
            }
        }
        if let Some(ref importance) = p.importance {
            count_params.push(Box::new(importance.clone()));
        }
        if let Some(ref tag_id) = p.tag_id {
            count_params.push(Box::new(tag_id.clone()));
        }
        let count_refs: Vec<&dyn rusqlite::types::ToSql> =
            count_params.iter().map(|b| b.as_ref()).collect();
        let mut stmt = conn.prepare(&count_sql)?;
        stmt.query_row(count_refs.as_slice(), |row| row.get(0))?
    };

    let contacts = hydrate_tags(conn, contacts)?;
    Ok((contacts, total))
}

pub fn create(conn: &Connection, input: &CreateContactInput) -> rusqlite::Result<Contact> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    let importance = input.importance.clone().unwrap_or_else(|| "normal".to_string());

    conn.execute(
        "INSERT INTO Contact \
         (id, user_id, nickname, name, company, title, city, \
          email, phone, wechat, notes, importance, reminder_enabled, \
          reminder_interval_days, last_contacted_at, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, \
                 ?8, ?9, ?10, ?11, ?12, ?13, \
                 ?14, ?15, ?16, ?17)",
        rusqlite::params![
            &id,
            &input.user_id,
            &input.nickname,
            &input.name,
            &input.company,
            &input.title,
            &input.city,
            &input.email,
            &input.phone,
            &input.wechat,
            &input.notes,
            &importance,
            &1i64,
            None::<String>,
            None::<String>,
            &now,
            &now,
        ],
    )?;

    if let Some(ref tag_ids) = input.tag_ids {
        for tag_id in tag_ids {
            conn.execute(
                "INSERT INTO ContactTag (user_id, contact_id, tag_id) VALUES (?1, ?2, ?3)",
                rusqlite::params![&input.user_id, &id, tag_id],
            )?;
        }
    }

    let contact = conn.query_row(
        "SELECT * FROM Contact WHERE id = ?1",
        rusqlite::params![&id],
        row_to_contact,
    )?;
    let tags = load_tags_for_contact(conn, &id)?;
    Ok(Contact { tags, ..contact })
}

pub fn update(conn: &Connection, input: &UpdateContactInput) -> rusqlite::Result<Contact> {
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    let mut sql = String::from("UPDATE Contact SET ");
    let mut set_clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1;

    if let Some(ref nickname) = input.nickname {
        set_clauses.push(format!("nickname = ?{}", param_idx));
        params.push(Box::new(nickname.clone()));
        param_idx += 1;
    }
    if let Some(ref name) = input.name {
        set_clauses.push(format!("name = ?{}", param_idx));
        params.push(Box::new(name.clone()));
        param_idx += 1;
    }
    if let Some(ref company) = input.company {
        set_clauses.push(format!("company = ?{}", param_idx));
        params.push(Box::new(company.clone()));
        param_idx += 1;
    }
    if let Some(ref title) = input.title {
        set_clauses.push(format!("title = ?{}", param_idx));
        params.push(Box::new(title.clone()));
        param_idx += 1;
    }
    if let Some(ref city) = input.city {
        set_clauses.push(format!("city = ?{}", param_idx));
        params.push(Box::new(city.clone()));
        param_idx += 1;
    }
    if let Some(ref email) = input.email {
        set_clauses.push(format!("email = ?{}", param_idx));
        params.push(Box::new(email.clone()));
        param_idx += 1;
    }
    if let Some(ref phone) = input.phone {
        set_clauses.push(format!("phone = ?{}", param_idx));
        params.push(Box::new(phone.clone()));
        param_idx += 1;
    }
    if let Some(ref wechat) = input.wechat {
        set_clauses.push(format!("wechat = ?{}", param_idx));
        params.push(Box::new(wechat.clone()));
        param_idx += 1;
    }
    if let Some(ref notes) = input.notes {
        set_clauses.push(format!("notes = ?{}", param_idx));
        params.push(Box::new(notes.clone()));
        param_idx += 1;
    }
    if let Some(ref imp) = input.importance {
        set_clauses.push(format!("importance = ?{}", param_idx));
        params.push(Box::new(imp.clone()));
        param_idx += 1;
    }

    // Always bump updated_at
    set_clauses.push(format!("updated_at = ?{}", param_idx));
    params.push(Box::new(now));
    param_idx += 1;

    sql.push_str(&set_clauses.join(", "));
    sql.push_str(&format!(" WHERE id = ?{}", param_idx));
    params.push(Box::new(input.id.clone()));

    {
        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|b| b.as_ref()).collect();
        conn.execute(&sql, params_refs.as_slice())?;
    }

    if let Some(ref tag_ids) = input.tag_ids {
        let user_id: String = conn.query_row(
            "SELECT user_id FROM Contact WHERE id = ?1",
            rusqlite::params![&input.id],
            |row| row.get(0),
        )?;

        conn.execute(
            "DELETE FROM ContactTag WHERE contact_id = ?1",
            rusqlite::params![&input.id],
        )?;

        for tag_id in tag_ids {
            conn.execute(
                "INSERT INTO ContactTag (user_id, contact_id, tag_id) VALUES (?1, ?2, ?3)",
                rusqlite::params![&user_id, &input.id, tag_id],
            )?;
        }
    }

    let contact = conn.query_row(
        "SELECT * FROM Contact WHERE id = ?1",
        rusqlite::params![&input.id],
        row_to_contact,
    )?;
    let tags = load_tags_for_contact(conn, &input.id)?;
    Ok(Contact { tags, ..contact })
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM Contact WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Contact> {
    let contact = conn.query_row(
        "SELECT * FROM Contact WHERE id = ?1",
        rusqlite::params![id],
        row_to_contact,
    )?;
    let tags = load_tags_for_contact(conn, id)?;
    Ok(Contact { tags, ..contact })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migration;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migration::run(&conn).unwrap();
        conn
    }

    fn insert_contact(
        conn: &Connection,
        id: &str,
        nickname: &str,
        last_contacted_at: Option<&str>,
        created_at: &str,
        updated_at: &str,
    ) {
        conn.execute(
            "INSERT INTO Contact (id, user_id, nickname, name, importance, last_contacted_at, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                id,
                "local-default",
                nickname,
                nickname,
                "normal",
                last_contacted_at,
                created_at,
                updated_at,
            ],
        )
        .unwrap();
    }

    #[test]
    fn list_with_sort_by_last_contacted_at_returns_20_items_and_total_25() {
        let conn = setup_db();
        for i in 0..25 {
            let id = format!("c-{:02}", i);
            let nickname = format!("Contact {}", i);
            let last_contacted = if i < 20 {
                Some(format!("2026-07-{:02}T10:00:00.000Z", 9 - (i / 3)))
            } else {
                None
            };
            let created = format!("2026-06-{:02}T00:00:00.000Z", i + 1);
            insert_contact(
                &conn,
                &id,
                &nickname,
                last_contacted.as_deref(),
                &created,
                &created,
            );
        }

        let params = ListContactsParams {
            user_id: "local-default".to_string(),
            tag_id: None,
            search: None,
            importance: None,
            sort_by: "last_contacted_at".to_string(),
            limit: 20,
            offset: 0,
        };
        let (items, total) = list(&conn, &params).unwrap();
        assert_eq!(items.len(), 20, "first page should have 20 items");
        assert_eq!(total, 25, "total should be 25");
    }

    #[test]
    fn list_with_sort_by_last_contacted_at_page_2_returns_5_items() {
        let conn = setup_db();
        for i in 0..25 {
            let id = format!("c-{:02}", i);
            let nickname = format!("c {}", i);
            let last_contacted = if i < 20 {
                Some(format!("2026-06-{:02}T10:00:00.000Z", 30 - i))
            } else {
                None
            };
            let created = format!("2026-06-{:02}T00:00:00.000Z", i + 1);
            insert_contact(
                &conn,
                &id,
                &nickname,
                last_contacted.as_deref(),
                &created,
                &created,
            );
        }

        let params = ListContactsParams {
            user_id: "local-default".to_string(),
            tag_id: None,
            search: None,
            importance: None,
            sort_by: "last_contacted_at".to_string(),
            limit: 20,
            offset: 20,
        };
        let (items, total) = list(&conn, &params).unwrap();
        assert_eq!(items.len(), 5, "second page should have 5 items");
        assert_eq!(total, 25);
    }

    #[test]
    fn list_with_sort_by_created_at_returns_desc_order() {
        let conn = setup_db();
        for i in 0..5 {
            let id = format!("c-{}", i);
            let nickname = format!("c {}", i);
            let created = format!("2026-06-{:02}T00:00:00.000Z", i + 1);
            insert_contact(&conn, &id, &nickname, None, &created, &created);
        }

        let params = ListContactsParams {
            user_id: "local-default".to_string(),
            tag_id: None,
            search: None,
            importance: None,
            sort_by: "created_at".to_string(),
            limit: 20,
            offset: 0,
        };
        let (items, _total) = list(&conn, &params).unwrap();
        assert_eq!(items.len(), 5);
        assert!(items[0].created_at > items[4].created_at);
    }

    #[test]
    fn list_with_sort_by_nickname_returns_asc_order() {
        let conn = setup_db();
        insert_contact(&conn, "c-1", "Zebra", None, "2026-06-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z");
        insert_contact(&conn, "c-2", "alpha", None, "2026-06-02T00:00:00.000Z", "2026-06-02T00:00:00.000Z");
        insert_contact(&conn, "c-3", "Bravo", None, "2026-06-03T00:00:00.000Z", "2026-06-03T00:00:00.000Z");
        insert_contact(&conn, "c-4", "ALPHA", None, "2026-06-04T00:00:00.000Z", "2026-06-04T00:00:00.000Z");

        let params = ListContactsParams {
            user_id: "local-default".to_string(),
            tag_id: None,
            search: None,
            importance: None,
            sort_by: "nickname".to_string(),
            limit: 20,
            offset: 0,
        };
        let (items, _total) = list(&conn, &params).unwrap();
        assert_eq!(items.len(), 4);
        assert!(items[0].nickname.to_lowercase() <= items[1].nickname.to_lowercase());
        assert!(items[1].nickname.to_lowercase() <= items[2].nickname.to_lowercase());
        assert!(items[2].nickname.to_lowercase() <= items[3].nickname.to_lowercase());
    }

    #[test]
    fn list_with_invalid_sort_by_falls_back_to_updated_at() {
        let conn = setup_db();
        insert_contact(&conn, "c-1", "Test", None, "2026-06-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z");

        let params = ListContactsParams {
            user_id: "local-default".to_string(),
            tag_id: None,
            search: None,
            importance: None,
            sort_by: "garbage".to_string(),
            limit: 20,
            offset: 0,
        };
        let (items, total) = list(&conn, &params).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(total, 1);
    }

    #[test]
    fn list_with_limit_zero_uses_default() {
        let conn = setup_db();
        for i in 0..5 {
            let id = format!("c-{}", i);
            let nickname = format!("c {}", i);
            let created = format!("2026-06-{:02}T00:00:00.000Z", i + 1);
            insert_contact(&conn, &id, &nickname, None, &created, &created);
        }

        let params = ListContactsParams {
            user_id: "local-default".to_string(),
            tag_id: None,
            search: None,
            importance: None,
            sort_by: "created_at".to_string(),
            limit: 0,
            offset: 0,
        };
        let (items, total) = list(&conn, &params).unwrap();
        assert_eq!(items.len(), 5, "limit=0 should default to 20, returning all 5");
        assert_eq!(total, 5);
    }

    #[test]
    fn list_with_limit_exceeding_max_clamps_to_max() {
        let conn = setup_db();
        for i in 0..250 {
            let id = format!("c-{}", i);
            let nickname = format!("c {}", i);
            let created = format!("2026-06-{:02}T00:00:00.000Z", (i % 30) + 1);
            insert_contact(&conn, &id, &nickname, None, &created, &created);
        }

        let params = ListContactsParams {
            user_id: "local-default".to_string(),
            tag_id: None,
            search: None,
            importance: None,
            sort_by: "created_at".to_string(),
            limit: 1000,
            offset: 0,
        };
        let (items, total) = list(&conn, &params).unwrap();
        assert_eq!(items.len(), 200, "limit 1000 should clamp to MAX_CONTACT_LIMIT (200)");
        assert_eq!(total, 250);
    }

    #[test]
    fn list_with_negative_offset_uses_zero() {
        let conn = setup_db();
        insert_contact(&conn, "c-1", "Test", None, "2026-06-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z");

        let params = ListContactsParams {
            user_id: "local-default".to_string(),
            tag_id: None,
            search: None,
            importance: None,
            sort_by: "created_at".to_string(),
            limit: 20,
            offset: -5,
        };
        let (items, total) = list(&conn, &params).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(total, 1);
    }
}