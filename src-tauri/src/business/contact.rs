use crate::models::*;
use rusqlite::Connection;
use uuid::Uuid;

pub(crate) fn row_to_contact(row: &rusqlite::Row) -> rusqlite::Result<Contact> {
    Ok(Contact {
        id: row.get(0)?,
        owner_id: row.get(1)?,
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

pub fn list(conn: &Connection, p: &ListContactsParams) -> rusqlite::Result<Vec<Contact>> {
    let mut sql = String::from("SELECT * FROM Contact WHERE ownerId = ?1");
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> =
        vec![Box::new(p.owner_id.clone())];
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
            " AND id IN (SELECT contactId FROM ContactTag WHERE tagId = ?{})",
            idx
        ));
        param_values.push(Box::new(tag_id.clone()));
    }

    sql.push_str(" ORDER BY updatedAt DESC");

    let mut stmt = conn.prepare(&sql)?;
    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|b| b.as_ref()).collect();

    let contacts = stmt
        .query_map(params_refs.as_slice(), row_to_contact)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(contacts)
}

pub fn create(conn: &Connection, input: &CreateContactInput) -> rusqlite::Result<Contact> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    let importance = input.importance.clone().unwrap_or_else(|| "normal".to_string());

    conn.execute(
        "INSERT INTO Contact \
         (id, ownerId, nickname, name, company, title, city, \
          email, phone, wechat, notes, importance, reminderEnabled, \
          reminderIntervalDays, lastContactedAt, createdAt, updatedAt) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, \
                 ?8, ?9, ?10, ?11, ?12, ?13, \
                 ?14, ?15, ?16, ?17)",
        rusqlite::params![
            &id,
            &input.owner_id,
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
                "INSERT INTO ContactTag (ownerId, contactId, tagId) VALUES (?1, ?2, ?3)",
                rusqlite::params![&input.owner_id, &id, tag_id],
            )?;
        }
    }

    conn.query_row(
        "SELECT * FROM Contact WHERE id = ?1",
        rusqlite::params![&id],
        row_to_contact,
    )
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

    // Always bump updatedAt
    set_clauses.push(format!("updatedAt = ?{}", param_idx));
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
        let owner_id: String = conn.query_row(
            "SELECT ownerId FROM Contact WHERE id = ?1",
            rusqlite::params![&input.id],
            |row| row.get(0),
        )?;

        conn.execute(
            "DELETE FROM ContactTag WHERE contactId = ?1",
            rusqlite::params![&input.id],
        )?;

        for tag_id in tag_ids {
            conn.execute(
                "INSERT INTO ContactTag (ownerId, contactId, tagId) VALUES (?1, ?2, ?3)",
                rusqlite::params![&owner_id, &input.id, tag_id],
            )?;
        }
    }

    conn.query_row(
        "SELECT * FROM Contact WHERE id = ?1",
        rusqlite::params![&input.id],
        row_to_contact,
    )
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM Contact WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Contact> {
    conn.query_row(
        "SELECT * FROM Contact WHERE id = ?1",
        rusqlite::params![id],
        row_to_contact,
    )
}
