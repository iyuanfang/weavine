use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

pub const SUPPORTED_ENTITY_TYPES: &[&str] = &["contact", "project", "event", "action", "note", "interaction", "tag"];

#[derive(Debug, Serialize)]
pub struct EntityGraphNode {
    pub id: String,
    pub entity_type: &'static str,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(default)]
    pub is_center: bool,
}

#[derive(Debug, Serialize)]
pub struct EntityGraphEdge {
    pub from_type: String,
    pub from_id: String,
    pub to_type: String,
    pub to_id: String,
    pub relation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct EntityGraphResponse {
    pub center_type: String,
    pub center_id: String,
    pub depth: i32,
    pub nodes: Vec<EntityGraphNode>,
    pub edges: Vec<EntityGraphEdge>,
}

fn label_or(s: Option<String>, fallback: &str) -> String {
    s.and_then(|v| {
        let t = v.trim().to_string();
        if t.is_empty() { None } else { Some(t) }
    })
    .unwrap_or_else(|| fallback.to_string())
}

fn push_neighbor(
    response: &mut EntityGraphResponse,
    entity_type: &'static str,
    id: String,
    label: String,
    subtitle: Option<String>,
    from_type: &str,
    from_id: &str,
    relation: &str,
) {
    response.nodes.push(EntityGraphNode {
        id: id.clone(),
        entity_type,
        label,
        subtitle,
        is_center: false,
    });
    response.edges.push(EntityGraphEdge {
        from_type: from_type.into(),
        from_id: from_id.into(),
        to_type: entity_type.into(),
        to_id: id,
        relation: relation.into(),
        label: None,
    });
}

fn load_center_node(
    conn: &Connection,
    user_id: &str,
    entity_type: &str,
    entity_id: &str,
) -> rusqlite::Result<Option<EntityGraphNode>> {
    let row: Option<(String, Option<String>)> = match entity_type {
        "contact" => conn.query_row(
            "SELECT id, nickname FROM \"Contact\" WHERE id = ?1 AND user_id = ?2 AND archived_at IS NULL AND deleted_at IS NULL",
            params![entity_id, user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?,
        "project" => conn.query_row(
            "SELECT id, title FROM \"Project\" WHERE id = ?1 AND user_id = ?2 AND archived_at IS NULL AND deleted_at IS NULL",
            params![entity_id, user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?,
        "event" => conn.query_row(
            "SELECT id, title FROM \"Event\" WHERE id = ?1 AND user_id = ?2 AND archived_at IS NULL AND deleted_at IS NULL",
            params![entity_id, user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?,
        "action" => conn.query_row(
            "SELECT id, title FROM \"Action\" WHERE id = ?1 AND user_id = ?2 AND archived_at IS NULL AND deleted_at IS NULL",
            params![entity_id, user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?,
        "note" => conn.query_row(
            "SELECT id, title FROM \"Note\" WHERE id = ?1 AND user_id = ?2 AND archived_at IS NULL AND deleted_at IS NULL",
            params![entity_id, user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?,
        "tag" => conn.query_row(
            "SELECT id, name FROM \"Tag\" WHERE deleted_at IS NULL AND id = ?1 AND user_id = ?2",
            params![entity_id, user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?,
        "interaction" => conn.query_row(
            "SELECT id, summary FROM \"Interaction\" WHERE deleted_at IS NULL AND id = ?1 AND user_id = ?2",
            params![entity_id, user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?,
        _ => return Ok(None),
    };

    let et: &'static str = match entity_type {
        "contact" => "contact",
        "project" => "project",
        "event" => "event",
        "action" => "action",
        "note" => "note",
        "tag" => "tag",
        "interaction" => "interaction",
        _ => return Ok(None),
    };

    Ok(row.map(|(id, label)| EntityGraphNode {
        id,
        entity_type: et,
        label: label_or(label, "(untitled)"),
        subtitle: None,
        is_center: true,
    }))
}

fn expand_contact(
    conn: &Connection,
    user_id: &str,
    contact_id: &str,
    response: &mut EntityGraphResponse,
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.title FROM \"ProjectContact\" pc \
         JOIN \"Project\" p ON p.id = pc.project_id \
         WHERE pc.contact_id = ?1 AND pc.user_id = ?2 AND p.archived_at IS NULL AND p.deleted_at IS NULL",
    )?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![contact_id, user_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();
    for (id, title) in rows {
        push_neighbor(response, "project", id, label_or(Some(title), "(untitled)"), None, "contact", contact_id, "project_member");
    }

    let mut stmt = conn.prepare(
        "SELECT id, title FROM \"Event\" WHERE contact_id = ?1 AND user_id = ?2 AND archived_at IS NULL AND deleted_at IS NULL",
    )?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![contact_id, user_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();
    for (id, title) in rows {
        push_neighbor(response, "event", id, label_or(Some(title), "(untitled)"), None, "contact", contact_id, "event_attendee");
    }

    let mut stmt = conn.prepare(
        "SELECT id, title FROM \"Action\" WHERE contact_id = ?1 AND user_id = ?2 AND archived_at IS NULL AND deleted_at IS NULL",
    )?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![contact_id, user_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();
    for (id, title) in rows {
        push_neighbor(response, "action", id, label_or(Some(title), "(untitled)"), None, "contact", contact_id, "action_assignee");
    }

    let mut stmt = conn.prepare(
        "SELECT id, summary FROM \"Interaction\" WHERE deleted_at IS NULL AND contact_id = ?1 AND user_id = ?2",
    )?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![contact_id, user_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();
    for (id, summary) in rows {
        push_neighbor(response, "interaction", id, label_or(Some(summary), "(no summary)"), None, "contact", contact_id, "has_interaction");
    }

    let mut stmt = conn.prepare(
        "SELECT n.id, n.title FROM \"NoteEntity\" ne \
         JOIN \"Note\" n ON n.id = ne.note_id \
         WHERE ne.entity_type = 'contact' AND ne.entity_id = ?1 AND ne.user_id = ?2 AND n.archived_at IS NULL AND n.deleted_at IS NULL",
    )?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![contact_id, user_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();
    for (id, title) in rows {
        push_neighbor(response, "note", id, label_or(Some(title), "(untitled)"), None, "contact", contact_id, "note_mentions");
    }

    /**
     * Tag neighbors intentionally omitted: GraphView UI redesign (2026-07-13)
     * removed the tag filter toggle, and tag nodes lack TYPE_META definitions
     * in the frontend, causing layout errors. Tags are still discoverable via
     * the contact detail page's tag list. See server/handlers/graph.rs for the
     * same exclusion on the server side.
     */
    Ok(())
}
fn expand_project(
    conn: &Connection,
    user_id: &str,
    project_id: &str,
    response: &mut EntityGraphResponse,
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.nickname FROM \"ProjectContact\" pc \
         JOIN \"Contact\" c ON c.id = pc.contact_id \
         WHERE pc.project_id = ?1 AND pc.user_id = ?2 AND c.archived_at IS NULL AND c.deleted_at IS NULL",
    )?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![project_id, user_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();
    for (id, nickname) in rows {
        push_neighbor(response, "contact", id, label_or(Some(nickname), "(unnamed)"), None, "project", project_id, "project_member");
    }

    let mut stmt = conn.prepare(
        "SELECT id, title FROM \"Event\" WHERE project_id = ?1 AND user_id = ?2 AND archived_at IS NULL AND deleted_at IS NULL",
    )?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![project_id, user_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();
    for (id, title) in rows {
        push_neighbor(response, "event", id, label_or(Some(title), "(untitled)"), None, "project", project_id, "event_for_project");
    }

    let mut stmt = conn.prepare(
        "SELECT id, title FROM \"Action\" WHERE project_id = ?1 AND user_id = ?2 AND archived_at IS NULL AND deleted_at IS NULL",
    )?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![project_id, user_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();
    for (id, title) in rows {
        push_neighbor(response, "action", id, label_or(Some(title), "(untitled)"), None, "project", project_id, "action_for_project");
    }

    let mut stmt = conn.prepare(
        "SELECT n.id, n.title FROM \"NoteEntity\" ne \
         JOIN \"Note\" n ON n.id = ne.note_id \
         WHERE ne.entity_type = 'project' AND ne.entity_id = ?1 AND ne.user_id = ?2 AND n.archived_at IS NULL AND n.deleted_at IS NULL",
    )?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![project_id, user_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();
    for (id, title) in rows {
        push_neighbor(response, "note", id, label_or(Some(title), "(untitled)"), None, "project", project_id, "note_mentions");
    }

    Ok(())
}

fn expand_event(
    conn: &Connection,
    user_id: &str,
    event_id: &str,
    response: &mut EntityGraphResponse,
) -> rusqlite::Result<()> {
    let (contact_id, project_id): (Option<String>, Option<String>) = conn.query_row(
        "SELECT contact_id, project_id FROM \"Event\" WHERE id = ?1 AND user_id = ?2",
        params![event_id, user_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).optional()?.unwrap_or((None, None));

    if let Some(cid) = contact_id {
        let nickname: Option<String> = conn.query_row(
            "SELECT nickname FROM \"Contact\" WHERE id = ?1 AND user_id = ?2 AND archived_at IS NULL AND deleted_at IS NULL",
            params![&cid, user_id],
            |r| r.get(0),
        ).optional()?;
        if let Some(label) = nickname {
            push_neighbor(response, "contact", cid, label_or(Some(label), "(unnamed)"), None, "event", event_id, "event_attendee");
        }
    }

    if let Some(pid) = project_id {
        let title: Option<String> = conn.query_row(
            "SELECT title FROM \"Project\" WHERE id = ?1 AND user_id = ?2 AND archived_at IS NULL AND deleted_at IS NULL",
            params![&pid, user_id],
            |r| r.get(0),
        ).optional()?;
        if let Some(label) = title {
            push_neighbor(response, "project", pid, label_or(Some(label), "(untitled)"), None, "event", event_id, "event_for_project");
        }
    }

    let mut stmt = conn.prepare(
        "SELECT a.id, a.title FROM \"Action\" a \
         WHERE a.user_id = ?1 AND a.archived_at IS NULL AND a.deleted_at IS NULL \
           AND a.id IN (SELECT action_id FROM \"Interaction\" WHERE deleted_at IS NULL AND event_id = ?2 AND action_id IS NOT NULL)",
    )?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![user_id, event_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();
    for (id, title) in rows {
        push_neighbor(response, "action", id, label_or(Some(title), "(untitled)"), None, "event", event_id, "action_in_event");
    }

    let mut stmt = conn.prepare(
        "SELECT id, summary FROM \"Interaction\" WHERE deleted_at IS NULL AND event_id = ?1 AND user_id = ?2",
    )?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![event_id, user_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();
    for (id, summary) in rows {
        push_neighbor(response, "interaction", id, label_or(Some(summary), "(no summary)"), None, "event", event_id, "event_has_interaction");
    }

    let mut stmt = conn.prepare(
        "SELECT n.id, n.title FROM \"NoteEntity\" ne \
         JOIN \"Note\" n ON n.id = ne.note_id \
         WHERE ne.entity_type = 'event' AND ne.entity_id = ?1 AND ne.user_id = ?2 AND n.archived_at IS NULL AND n.deleted_at IS NULL",
    )?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![event_id, user_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();
    for (id, title) in rows {
        push_neighbor(response, "note", id, label_or(Some(title), "(untitled)"), None, "event", event_id, "note_mentions");
    }

    Ok(())
}

fn expand_action(
    conn: &Connection,
    user_id: &str,
    action_id: &str,
    response: &mut EntityGraphResponse,
) -> rusqlite::Result<()> {
    let (contact_id, project_id): (Option<String>, Option<String>) = conn.query_row(
        "SELECT contact_id, project_id FROM \"Action\" WHERE id = ?1 AND user_id = ?2",
        params![action_id, user_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).optional()?.unwrap_or((None, None));

    if let Some(cid) = contact_id {
        let nickname: Option<String> = conn.query_row(
            "SELECT nickname FROM \"Contact\" WHERE id = ?1 AND user_id = ?2 AND archived_at IS NULL AND deleted_at IS NULL",
            params![&cid, user_id],
            |r| r.get(0),
        ).optional()?;
        if let Some(label) = nickname {
            push_neighbor(response, "contact", cid, label_or(Some(label), "(unnamed)"), None, "action", action_id, "action_assignee");
        }
    }

    if let Some(pid) = project_id {
        let title: Option<String> = conn.query_row(
            "SELECT title FROM \"Project\" WHERE id = ?1 AND user_id = ?2 AND archived_at IS NULL AND deleted_at IS NULL",
            params![&pid, user_id],
            |r| r.get(0),
        ).optional()?;
        if let Some(label) = title {
            push_neighbor(response, "project", pid, label_or(Some(label), "(untitled)"), None, "action", action_id, "action_for_project");
        }
    }

    let mut stmt = conn.prepare(
        "SELECT e.id, e.title FROM \"Event\" e \
         WHERE e.user_id = ?1 AND e.archived_at IS NULL AND e.deleted_at IS NULL \
           AND e.id IN (SELECT event_id FROM \"Interaction\" WHERE deleted_at IS NULL AND action_id = ?2 AND event_id IS NOT NULL)",
    )?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![user_id, action_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();
    for (id, title) in rows {
        push_neighbor(response, "event", id, label_or(Some(title), "(untitled)"), None, "action", action_id, "action_in_event");
    }

    let mut stmt = conn.prepare(
        "SELECT id, summary FROM \"Interaction\" WHERE deleted_at IS NULL AND action_id = ?1 AND user_id = ?2",
    )?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![action_id, user_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();
    for (id, summary) in rows {
        push_neighbor(response, "interaction", id, label_or(Some(summary), "(no summary)"), None, "action", action_id, "action_has_interaction");
    }

    let mut stmt = conn.prepare(
        "SELECT n.id, n.title FROM \"NoteEntity\" ne \
         JOIN \"Note\" n ON n.id = ne.note_id \
         WHERE ne.entity_type = 'action' AND ne.entity_id = ?1 AND ne.user_id = ?2 AND n.archived_at IS NULL AND n.deleted_at IS NULL",
    )?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![action_id, user_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();
    for (id, title) in rows {
        push_neighbor(response, "note", id, label_or(Some(title), "(untitled)"), None, "action", action_id, "note_mentions");
    }

    Ok(())
}

fn expand_interaction(
    conn: &Connection,
    user_id: &str,
    interaction_id: &str,
    response: &mut EntityGraphResponse,
) -> rusqlite::Result<()> {
    let (contact_id, action_id, event_id): (Option<String>, Option<String>, Option<String>) =
        conn.query_row(
            "SELECT contact_id, action_id, event_id FROM \"Interaction\" WHERE deleted_at IS NULL AND id = ?1 AND user_id = ?2",
            params![interaction_id, user_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .unwrap_or((None, None, None));

    if let Some(cid) = contact_id {
        let nickname: Option<String> = conn.query_row(
            "SELECT nickname FROM \"Contact\" WHERE id = ?1 AND user_id = ?2 AND archived_at IS NULL AND deleted_at IS NULL",
            params![&cid, user_id],
            |r| r.get(0),
        ).optional()?;
        if let Some(label) = nickname {
            push_neighbor(response, "contact", cid, label, None, "interaction", interaction_id, "interaction_with_contact");
        }
    }

    if let Some(aid) = action_id {
        let title: Option<String> = conn.query_row(
            "SELECT title FROM \"Action\" WHERE id = ?1 AND user_id = ?2 AND archived_at IS NULL AND deleted_at IS NULL",
            params![&aid, user_id],
            |r| r.get(0),
        ).optional()?;
        if let Some(label) = title {
            push_neighbor(response, "action", aid, label, None, "interaction", interaction_id, "interaction_via_action");
        }
    }

    if let Some(eid) = event_id {
        let title: Option<String> = conn.query_row(
            "SELECT title FROM \"Event\" WHERE id = ?1 AND user_id = ?2 AND archived_at IS NULL AND deleted_at IS NULL",
            params![&eid, user_id],
            |r| r.get(0),
        ).optional()?;
        if let Some(label) = title {
            push_neighbor(response, "event", eid, label, None, "interaction", interaction_id, "interaction_in_event");
        }
    }

    let mut stmt = conn.prepare(
        "SELECT n.id, n.title FROM \"NoteEntity\" ne \
         JOIN \"Note\" n ON n.id = ne.note_id \
         WHERE ne.entity_type = 'interaction' AND ne.entity_id = ?1 AND ne.user_id = ?2 AND n.archived_at IS NULL AND n.deleted_at IS NULL",
    )?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![interaction_id, user_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();
    for (id, title) in rows {
        push_neighbor(response, "note", id, title, None, "interaction", interaction_id, "note_mentions");
    }

    Ok(())
}

fn expand_note(
    conn: &Connection,
    user_id: &str,
    note_id: &str,
    response: &mut EntityGraphResponse,
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(
        "SELECT entity_type, entity_id FROM \"NoteEntity\" WHERE note_id = ?1 AND user_id = ?2",
    )?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![note_id, user_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();

    for (entity_type, entity_id) in rows {
        let (et, label_opt): (&'static str, Option<String>) = match entity_type.as_str() {
            "contact" => {
                let label = conn.query_row(
                    "SELECT nickname FROM \"Contact\" WHERE id = ?1 AND user_id = ?2 AND archived_at IS NULL AND deleted_at IS NULL",
                    params![&entity_id, user_id],
                    |r| r.get(0),
                ).optional()?;
                ("contact", label)
            }
            "project" => {
                let label = conn.query_row(
                    "SELECT title FROM \"Project\" WHERE id = ?1 AND user_id = ?2 AND archived_at IS NULL AND deleted_at IS NULL",
                    params![&entity_id, user_id],
                    |r| r.get(0),
                ).optional()?;
                ("project", label)
            }
            "event" => {
                let label = conn.query_row(
                    "SELECT title FROM \"Event\" WHERE id = ?1 AND user_id = ?2 AND archived_at IS NULL AND deleted_at IS NULL",
                    params![&entity_id, user_id],
                    |r| r.get(0),
                ).optional()?;
                ("event", label)
            }
            "action" => {
                let label = conn.query_row(
                    "SELECT title FROM \"Action\" WHERE id = ?1 AND user_id = ?2 AND archived_at IS NULL AND deleted_at IS NULL",
                    params![&entity_id, user_id],
                    |r| r.get(0),
                ).optional()?;
                ("action", label)
            }
            "interaction" => {
                let label = conn.query_row(
                    "SELECT summary FROM \"Interaction\" WHERE deleted_at IS NULL AND id = ?1 AND user_id = ?2",
                    params![&entity_id, user_id],
                    |r| r.get(0),
                ).optional()?;
                ("interaction", label)
            }
            _ => continue,
        };
        if let Some(label) = label_opt {
            push_neighbor(response, et, entity_id, label_or(Some(label), "(untitled)"), None, "note", note_id, "note_mentions");
        }
    }

    Ok(())
}

pub fn entity_graph(
    conn: &Connection,
    user_id: &str,
    entity_type: &str,
    entity_id: &str,
) -> rusqlite::Result<Option<EntityGraphResponse>> {
    if !SUPPORTED_ENTITY_TYPES.contains(&entity_type) {
        return Ok(None);
    }

    let center = match load_center_node(conn, user_id, entity_type, entity_id)? {
        Some(c) => c,
        None => return Ok(None),
    };

    let mut response = EntityGraphResponse {
        center_type: entity_type.to_string(),
        center_id: entity_id.to_string(),
        depth: 1,
        nodes: Vec::new(),
        edges: Vec::new(),
    };
    response.nodes.push(center);

    match entity_type {
        "contact" => expand_contact(conn, user_id, entity_id, &mut response)?,
        "project" => expand_project(conn, user_id, entity_id, &mut response)?,
        "event" => expand_event(conn, user_id, entity_id, &mut response)?,
        "action" => expand_action(conn, user_id, entity_id, &mut response)?,
        "note" => expand_note(conn, user_id, entity_id, &mut response)?,
        "interaction" => expand_interaction(conn, user_id, entity_id, &mut response)?,
        "tag" => expand_tag(conn, user_id, entity_id, &mut response)?,
        _ => {}
    }

    Ok(Some(response))
}

fn expand_tag(
    conn: &Connection,
    user_id: &str,
    tag_id: &str,
    response: &mut EntityGraphResponse,
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.nickname FROM \"ContactTag\" ct \
         JOIN \"Contact\" c ON c.id = ct.contact_id \
         WHERE ct.tag_id = ?1 AND ct.user_id = ?2 AND c.archived_at IS NULL AND c.deleted_at IS NULL",
    )?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![tag_id, user_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();
    for (id, nickname) in rows {
        push_neighbor(response, "contact", id, label_or(Some(nickname), "(untitled)"), None, "tag", tag_id, "tag_member");
    }

    Ok(())
}
