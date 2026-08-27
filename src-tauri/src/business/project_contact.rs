use crate::models::*;
use rusqlite::{params, Connection, OptionalExtension};

fn row_to_project_contact(row: &rusqlite::Row) -> rusqlite::Result<ProjectContact> {
    Ok(ProjectContact {
        user_id: row.get(0)?,
        project_id: row.get(1)?,
        contact_id: row.get(2)?,
        role: row.get(3)?,
        added_at: row.get(4)?,
    })
}

pub fn add(
    conn: &Connection,
    project_id: &str,
    contact_id: &str,
    role: Option<&str>,
) -> rusqlite::Result<ProjectContact> {
    // Look up the project's owner so the ProjectContact row gets the same
    // user_id (sync v0.2.0b requires this — `sync_log_change` reads from
    // NEW.user_id). Returns InvalidParameterName if the project is missing.
    let user_id: String = conn
        .query_row(
            "SELECT user_id FROM Project WHERE id = ?1",
            params![project_id],
            |r| r.get(0),
        )
        .map_err(|e| {
            rusqlite::Error::InvalidParameterName(format!(
                "project {project_id} not found: {e}"
            ))
        })?;

    // Confirm the contact exists. We previously required `Contact.user_id == project.user_id`,
    // but for a single-user desktop install that's redundant — and if sync ever
    // pulls a foreign-user_id row in (or the local user_id rotated), the strict
    // check silently rejected the add with no error surfaced to the UI. Now we
    // just verify the contact row is present and let the link proceed under the
    // project's user_id.
    let contact_exists: bool = conn
        .query_row(
            "SELECT 1 FROM Contact WHERE id = ?1",
            params![contact_id],
            |_| Ok(true),
        )
        .optional()
        .map_err(|e| {
            rusqlite::Error::InvalidParameterName(format!(
                "contact lookup failed: {e}"
            ))
        })?
        .unwrap_or(false);
    if !contact_exists {
        return Err(rusqlite::Error::InvalidParameterName(format!(
            "contact {contact_id} not found"
        )));
    }

    conn.execute(
        "INSERT INTO ProjectContact (user_id, project_id, contact_id, role) \
         VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT(project_id, contact_id) DO UPDATE SET role = excluded.role",
        params![user_id, project_id, contact_id, role],
    )?;

    let pc: ProjectContact = conn.query_row(
        "SELECT user_id, project_id, contact_id, role, added_at FROM ProjectContact \
         WHERE project_id = ?1 AND contact_id = ?2",
        params![project_id, contact_id],
        row_to_project_contact,
    )?;
    Ok(pc)
}

pub fn remove(conn: &Connection, project_id: &str, contact_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM ProjectContact WHERE project_id = ?1 AND contact_id = ?2",
        params![project_id, contact_id],
    )?;
    Ok(())
}

pub fn list_by_project(
    conn: &Connection,
    project_id: &str,
) -> rusqlite::Result<Vec<ProjectContact>> {
    let mut stmt = conn.prepare(
        "SELECT user_id, project_id, contact_id, role, added_at FROM ProjectContact \
         WHERE project_id = ?1 ORDER BY added_at DESC",
    )?;
    let rows = stmt
        .query_map(params![project_id], row_to_project_contact)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

pub fn list_contacts_for_project(
    conn: &Connection,
    project_id: &str,
) -> rusqlite::Result<Vec<ProjectContactWithContact>> {
    use crate::business::contact::hydrate_tags;
    let mut stmt = conn.prepare(
        "SELECT c.id, c.user_id, c.nickname, c.name, c.company, c.title, c.address, \
                c.email, c.phone, c.wechat, c.importance, \
                c.last_interaction_at, c.keep_in_touch_cadence_days, c.created_at, c.updated_at, \
                pc.role, pc.added_at \
         FROM Contact c \
         INNER JOIN ProjectContact pc ON pc.contact_id = c.id \
         WHERE pc.project_id = ?1 \
         ORDER BY pc.added_at DESC",
    )?;
    let rows: Vec<(Contact, Option<String>, String)> = stmt
        .query_map(params![project_id], |row| {
            let c = crate::business::contact::row_to_contact(row)?;
            // SELECT layout: idx 0-15 = Contact cols, 16 = pc.role, 17 = pc.added_at.
            Ok((c, row.get(16)?, row.get(17)?))
        })?
        .filter_map(|r| r.ok())
        .collect();
    let (contacts, roles, added_ats): (Vec<Contact>, Vec<Option<String>>, Vec<String>) =
        rows.into_iter().fold(
            (Vec::new(), Vec::new(), Vec::new()),
            |(mut cs, mut rs, mut at), (c, r, a)| {
                cs.push(c);
                rs.push(r);
                at.push(a);
                (cs, rs, at)
            },
        );
    let contacts = hydrate_tags(conn, contacts)?;
    Ok(contacts
        .into_iter()
        .zip(roles)
        .zip(added_ats)
        .map(|((c, r), a)| ProjectContactWithContact {
            contact: c,
            role: r,
            added_at: a,
        })
        .collect())
}
