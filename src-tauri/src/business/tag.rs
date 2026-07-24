use crate::models::*;
use crate::tag_color::color_for;
use rusqlite::Connection;
use uuid::Uuid;

pub(crate) fn row_to_tag(row: &rusqlite::Row) -> rusqlite::Result<Tag> {
    Ok(Tag {
        id: row.get(0)?,
        user_id: row.get(1)?,
        name: row.get(2)?,
        color: row.get(3)?,
        created_at: row.get(4)?,
    })
}

pub fn list(conn: &Connection, user_id: &str) -> rusqlite::Result<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT id, user_id, name, color, created_at FROM Tag WHERE user_id = ?1 ORDER BY name ASC",
    )?;

    let tags = stmt
        .query_map(rusqlite::params![user_id], row_to_tag)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tags)
}

pub fn create(conn: &Connection, input: &CreateTagInput) -> rusqlite::Result<Tag> {
    let id = Uuid::new_v4().to_string();
    let color = color_for(&input.name);

    conn.execute(
        "INSERT INTO Tag (id, user_id, name, color) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![&id, &input.user_id, &input.name, &color],
    )?;

    conn.query_row(
        "SELECT id, user_id, name, color, created_at FROM Tag WHERE id = ?1",
        rusqlite::params![&id],
        row_to_tag,
    )
}

pub fn update(conn: &Connection, input: &UpdateTagInput) -> rusqlite::Result<Tag> {
    let mut sql = String::from("UPDATE Tag SET ");
    let mut set_clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1;

    if let Some(ref n) = input.name {
        set_clauses.push(format!("name = ?{}", param_idx));
        params.push(Box::new(n.clone()));
        param_idx += 1;
        let new_color = color_for(n);
        set_clauses.push(format!("color = ?{}", param_idx));
        params.push(Box::new(new_color));
        param_idx += 1;
    }

    if set_clauses.is_empty() {
        return conn.query_row(
            "SELECT id, user_id, name, color, created_at FROM Tag WHERE id = ?1",
            rusqlite::params![&input.id],
            row_to_tag,
        );
    }

    sql.push_str(&set_clauses.join(", "));
    sql.push_str(&format!(" WHERE id = ?{}", param_idx));
    params.push(Box::new(input.id.clone()));

    {
        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|b| b.as_ref()).collect();
        conn.execute(&sql, params_refs.as_slice())?;
    }

    conn.query_row(
        "SELECT id, user_id, name, color, created_at FROM Tag WHERE id = ?1",
        rusqlite::params![&input.id],
        row_to_tag,
    )
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM Tag WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}
