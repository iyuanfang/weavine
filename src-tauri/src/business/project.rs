use crate::commands::project::{CreateProjectInput, UpdateProjectInput};
use crate::models::*;
use crate::project_template::Template;
use rusqlite::Connection;
use uuid::Uuid;

const PROJECT_COLS: &str =
    "id, ownerId, title, description, template, stage, startAt, dueAt, completedAt, archivedAt, createdAt, updatedAt";

pub(crate) fn row_to_project(row: &rusqlite::Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        owner_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        template: row.get(4)?,
        stage: row.get(5)?,
        start_at: row.get(6)?,
        due_at: row.get(7)?,
        completed_at: row.get(8)?,
        archived_at: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

pub fn list(
    conn: &Connection,
    owner_id: &str,
    template: Option<&str>,
    stage: Option<&str>,
    archived: Option<&str>,
    limit: Option<i64>,
) -> rusqlite::Result<Vec<Project>> {
    let limit = limit.unwrap_or(100);

    let mut sql = format!(
        "SELECT {PROJECT_COLS} FROM \"Project\" WHERE ownerId = ?1"
    );
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> =
        vec![Box::new(owner_id.to_string())];
    let mut idx = 2;

    if let Some(t) = template {
        sql.push_str(&format!(" AND template = ?{}", idx));
        param_values.push(Box::new(t.to_string()));
        idx += 1;
    }
    if let Some(s) = stage {
        sql.push_str(&format!(" AND stage = ?{}", idx));
        param_values.push(Box::new(s.to_string()));
        idx += 1;
    }
    match archived {
        Some(v) if v == "true" || v == "1" => {
            sql.push_str(" AND archivedAt IS NOT NULL");
        }
        Some(v) if v == "all" => {}
        _ => {
            sql.push_str(" AND archivedAt IS NULL");
        }
    }

    sql.push_str(&format!(" ORDER BY updatedAt DESC LIMIT ?{}", idx));
    param_values.push(Box::new(limit));

    let mut stmt = conn.prepare(&sql)?;
    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|b| b.as_ref()).collect();

    let projects = stmt
        .query_map(params_refs.as_slice(), row_to_project)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(projects)
}

pub fn create(conn: &Connection, input: &CreateProjectInput) -> rusqlite::Result<Project> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    let t = Template::from_str_opt(&input.template).ok_or_else(|| {
        rusqlite::Error::InvalidParameterName(format!("unknown template: {}", input.template))
    })?;
    let stage = t.first_stage().to_string();

    conn.execute(
        "INSERT INTO \"Project\" \
         (id, ownerId, title, description, template, stage, startAt, dueAt, completedAt, archivedAt, createdAt, updatedAt) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        rusqlite::params![
            &id,
            &input.owner_id,
            &input.title,
            &input.description,
            &input.template,
            &stage,
            &input.start_at,
            &input.due_at,
            None::<String>,
            None::<String>,
            &now,
            &now,
        ],
    )?;

    conn.query_row(
        &format!("SELECT {PROJECT_COLS} FROM \"Project\" WHERE id = ?1"),
        rusqlite::params![&id],
        row_to_project,
    )
}

pub fn update(conn: &Connection, input: &UpdateProjectInput) -> rusqlite::Result<Project> {
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    let current = get(conn, &input.id)?;
    let t = Template::from_str_opt(&current.template).ok_or_else(|| {
        rusqlite::Error::InvalidParameterName(format!(
            "unknown template in stored project: {}",
            current.template
        ))
    })?;

    let mut sql = String::from("UPDATE \"Project\" SET ");
    let mut set_clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1;

    if let Some(ref t) = input.title {
        set_clauses.push(format!("title = ?{}", param_idx));
        params.push(Box::new(t.clone()));
        param_idx += 1;
    }
    if let Some(ref d) = input.description {
        set_clauses.push(format!("description = ?{}", param_idx));
        params.push(Box::new(d.clone()));
        param_idx += 1;
    }
    if let Some(ref s) = input.stage {
        if !t.stages().contains(&s.as_str()) {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "stage '{}' is not valid for template '{}'",
                s,
                current.template
            )));
        }
        set_clauses.push(format!("stage = ?{}", param_idx));
        params.push(Box::new(s.clone()));
        param_idx += 1;
    }
    if let Some(ref s) = input.start_at {
        set_clauses.push(format!("startAt = ?{}", param_idx));
        params.push(Box::new(s.clone()));
        param_idx += 1;
    }
    if let Some(ref d) = input.due_at {
        set_clauses.push(format!("dueAt = ?{}", param_idx));
        params.push(Box::new(d.clone()));
        param_idx += 1;
    }

    let stage_updated = input.stage.is_some();
    let new_stage = input.stage.as_deref().unwrap_or(&current.stage);
    let now_terminal = t.is_terminal(new_stage);
    let was_terminal = current
        .completed_at
        .as_ref()
        .map(|_| true)
        .unwrap_or(false);

    if let Some(ref ca) = input.completed_at {
        set_clauses.push(format!("completedAt = ?{}", param_idx));
        params.push(Box::new(ca.clone()));
        param_idx += 1;
    } else if stage_updated && now_terminal && !was_terminal {
        set_clauses.push(format!("completedAt = ?{}", param_idx));
        params.push(Box::new(now.clone()));
        param_idx += 1;
    } else if stage_updated && !now_terminal && was_terminal {
        set_clauses.push(format!("completedAt = ?{}", param_idx));
        params.push(Box::new(None::<String>));
        param_idx += 1;
    }

    if let Some(ref aa) = input.archived_at {
        set_clauses.push(format!("archivedAt = ?{}", param_idx));
        params.push(Box::new(aa.clone()));
        param_idx += 1;
    }

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

    conn.query_row(
        &format!("SELECT {PROJECT_COLS} FROM \"Project\" WHERE id = ?1"),
        rusqlite::params![&input.id],
        row_to_project,
    )
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM \"Project\" WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Project> {
    conn.query_row(
        &format!("SELECT {PROJECT_COLS} FROM \"Project\" WHERE id = ?1"),
        rusqlite::params![id],
        row_to_project,
    )
}

pub fn list_stages(template: &str) -> Result<Vec<String>, String> {
    let t = Template::from_str_opt(template)
        .ok_or_else(|| format!("unknown template: {template}"))?;
    Ok(t.stages().iter().map(|s| s.to_string()).collect())
}
