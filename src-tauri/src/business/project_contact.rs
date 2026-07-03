use crate::models::*;
use rusqlite::{params, Connection};

fn row_to_project_contact(row: &rusqlite::Row) -> rusqlite::Result<ProjectContact> {
    Ok(ProjectContact {
        owner_id: row.get(0)?,
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
    let owner_id: String = conn
        .query_row(
            "SELECT ownerId FROM Project WHERE id = ?1",
            params![project_id],
            |r| r.get(0),
        )
        .map_err(|e| {
            rusqlite::Error::InvalidParameterName(format!(
                "project {project_id} not found: {e}"
            ))
        })?;

    let contact_owner: Option<String> = conn
        .query_row(
            "SELECT ownerId FROM Contact WHERE id = ?1",
            params![contact_id],
            |r| r.get(0),
        )
        .ok();
    match contact_owner {
        Some(c) if c == owner_id => {}
        Some(_) => {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "contact {contact_id} owner mismatch"
            )));
        }
        None => {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "contact {contact_id} not found"
            )));
        }
    }

    conn.execute(
        "INSERT OR IGNORE INTO ProjectContact (ownerId, projectId, contactId, role) \
         VALUES (?1, ?2, ?3, ?4)",
        params![owner_id, project_id, contact_id, role],
    )?;

    let pc: ProjectContact = conn.query_row(
        "SELECT ownerId, projectId, contactId, role, addedAt FROM ProjectContact \
         WHERE projectId = ?1 AND contactId = ?2",
        params![project_id, contact_id],
        row_to_project_contact,
    )?;
    Ok(pc)
}

pub fn remove(conn: &Connection, project_id: &str, contact_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM ProjectContact WHERE projectId = ?1 AND contactId = ?2",
        params![project_id, contact_id],
    )?;
    Ok(())
}

pub fn list_by_project(
    conn: &Connection,
    project_id: &str,
) -> rusqlite::Result<Vec<ProjectContact>> {
    let mut stmt = conn.prepare(
        "SELECT ownerId, projectId, contactId, role, addedAt FROM ProjectContact \
         WHERE projectId = ?1 ORDER BY addedAt DESC",
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
        "SELECT c.id, c.ownerId, c.nickname, c.name, c.company, c.title, c.city, \
                c.email, c.phone, c.wechat, c.notes, c.importance, c.reminderEnabled, \
                c.reminderIntervalDays, c.lastContactedAt, c.createdAt, c.updatedAt, \
                pc.role, pc.addedAt \
         FROM Contact c \
         INNER JOIN ProjectContact pc ON pc.contactId = c.id \
         WHERE pc.projectId = ?1 \
         ORDER BY pc.addedAt DESC",
    )?;
    let rows: Vec<(Contact, Option<String>, String)> = stmt
        .query_map(params![project_id], |row| {
            let c = crate::business::contact::row_to_contact(row)?;
            Ok((c, row.get(17)?, row.get(18)?))
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
        .zip(roles.into_iter())
        .zip(added_ats.into_iter())
        .map(|((c, r), a)| ProjectContactWithContact {
            contact: c,
            role: r,
            added_at: a,
        })
        .collect())
}
