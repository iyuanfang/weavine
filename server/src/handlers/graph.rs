use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Serialize;
use sqlx::PgPool;
use std::sync::Arc;

use super::auth::extract_auth;

pub const SUPPORTED_ENTITY_TYPES: &[&str] = &["contact", "project", "event", "action", "note"];

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

pub async fn entity_graph(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path((entity_type, entity_id)): Path<(String, String)>,
) -> Result<Json<EntityGraphResponse>, (StatusCode, String)> {
    if !SUPPORTED_ENTITY_TYPES.contains(&entity_type.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            format!(
                "unsupported entity_type '{}'; expected one of {:?}",
                entity_type, SUPPORTED_ENTITY_TYPES
            ),
        ));
    }

    let auth = extract_auth(&headers, pool.as_ref()).await?;

    let mut response = EntityGraphResponse {
        center_type: entity_type.clone(),
        center_id: entity_id.clone(),
        depth: 1,
        nodes: Vec::new(),
        edges: Vec::new(),
    };

    response.nodes.push(load_center_node(&pool, &auth, &entity_type, &entity_id).await?);

    match entity_type.as_str() {
        "contact" => expand_contact(&pool, &auth, &entity_id, &mut response).await?,
        "project" => expand_project(&pool, &auth, &entity_id, &mut response).await?,
        "event" => expand_event(&pool, &auth, &entity_id, &mut response).await?,
        "action" => expand_action(&pool, &auth, &entity_id, &mut response).await?,
        "note" => expand_note(&pool, &auth, &entity_id, &mut response).await?,
        _ => unreachable!("validated above"),
    }

    Ok(Json(response))
}

async fn load_center_node(
    pool: &PgPool,
    user_id: &str,
    entity_type: &str,
    entity_id: &str,
) -> Result<EntityGraphNode, (StatusCode, String)> {
    let row: Option<(String, Option<String>)> = match entity_type {
        "contact" => sqlx::query_as(
            "SELECT id, nickname FROM contact WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
        )
        .bind(entity_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        "project" => sqlx::query_as(
            "SELECT id, title FROM project WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND archived_at IS NULL",
        )
        .bind(entity_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        "event" => sqlx::query_as(
            "SELECT id, title FROM event WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND archived_at IS NULL",
        )
        .bind(entity_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        "action" => sqlx::query_as(
            "SELECT id, title FROM action WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND archived_at IS NULL",
        )
        .bind(entity_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        "note" => sqlx::query_as(
            "SELECT id, title FROM note WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND archived_at IS NULL",
        )
        .bind(entity_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        _ => unreachable!(),
    };

    let (id, label) = row.ok_or((
        StatusCode::NOT_FOUND,
        format!("{} not found or not owned by user", entity_type),
    ))?;
    let entity_type_static: &'static str = match entity_type {
        "contact" => "contact",
        "project" => "project",
        "event" => "event",
        "action" => "action",
        "note" => "note",
        _ => unreachable!(),
    };
    Ok(EntityGraphNode {
        id,
        entity_type: entity_type_static,
        label: label.unwrap_or_else(|| "(untitled)".to_string()),
        subtitle: None,
        is_center: true,
    })
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

async fn expand_contact(
    pool: &PgPool,
    user_id: &str,
    contact_id: &str,
    response: &mut EntityGraphResponse,
) -> Result<(), (StatusCode, String)> {
    let projects: Vec<(String, String)> = sqlx::query_as(
        "SELECT p.id, p.title FROM project_contact pc \
         JOIN project p ON p.id = pc.project_id \
         WHERE pc.contact_id = $1 AND pc.user_id = $2 \
           AND p.deleted_at IS NULL AND p.archived_at IS NULL",
    )
    .bind(contact_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    for (id, title) in projects {
        push_neighbor(response, "project", id, title, None, "contact", contact_id, "project_member");
    }

    let events: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, title FROM event WHERE contact_id = $1 AND user_id = $2 \
           AND deleted_at IS NULL AND archived_at IS NULL",
    )
    .bind(contact_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    for (id, title) in events {
        push_neighbor(response, "event", id, title, None, "contact", contact_id, "event_attendee");
    }

    let actions: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, title FROM action WHERE contact_id = $1 AND user_id = $2 \
           AND deleted_at IS NULL AND archived_at IS NULL",
    )
    .bind(contact_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    for (id, title) in actions {
        push_neighbor(response, "action", id, title, None, "contact", contact_id, "action_assignee");
    }

    let notes: Vec<(String, String)> = sqlx::query_as(
        "SELECT n.id, n.title FROM note_entity ne \
         JOIN note n ON n.id = ne.note_id \
         WHERE ne.entity_type = 'contact' AND ne.entity_id = $1 AND ne.user_id = $2 \
           AND ne.deleted_at IS NULL AND n.deleted_at IS NULL AND n.archived_at IS NULL",
    )
    .bind(contact_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    for (id, title) in notes {
        push_neighbor(response, "note", id, title, None, "contact", contact_id, "note_mentions");
    }

    let tags: Vec<(String, String)> = sqlx::query_as(
        "SELECT t.id, t.name FROM contact_tag ct \
         JOIN tag t ON t.id = ct.tag_id \
         WHERE ct.contact_id = $1 AND ct.user_id = $2 AND t.deleted_at IS NULL",
    )
    .bind(contact_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    for (id, name) in tags {
        push_neighbor(response, "tag", id, name, None, "contact", contact_id, "tag");
    }

    Ok(())
}

async fn expand_project(
    pool: &PgPool,
    user_id: &str,
    project_id: &str,
    response: &mut EntityGraphResponse,
) -> Result<(), (StatusCode, String)> {
    let contacts: Vec<(String, String)> = sqlx::query_as(
        "SELECT c.id, c.nickname FROM project_contact pc \
         JOIN contact c ON c.id = pc.contact_id \
         WHERE pc.project_id = $1 AND pc.user_id = $2 AND c.deleted_at IS NULL",
    )
    .bind(project_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    for (id, nickname) in contacts {
        push_neighbor(response, "contact", id, nickname, None, "project", project_id, "project_member");
    }

    let events: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, title FROM event WHERE project_id = $1 AND user_id = $2 \
           AND deleted_at IS NULL AND archived_at IS NULL",
    )
    .bind(project_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    for (id, title) in events {
        push_neighbor(response, "event", id, title, None, "project", project_id, "event_for_project");
    }

    let actions: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, title FROM action WHERE project_id = $1 AND user_id = $2 \
           AND deleted_at IS NULL AND archived_at IS NULL",
    )
    .bind(project_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    for (id, title) in actions {
        push_neighbor(response, "action", id, title, None, "project", project_id, "action_for_project");
    }

    let notes: Vec<(String, String)> = sqlx::query_as(
        "SELECT n.id, n.title FROM note_entity ne \
         JOIN note n ON n.id = ne.note_id \
         WHERE ne.entity_type = 'project' AND ne.entity_id = $1 AND ne.user_id = $2 \
           AND ne.deleted_at IS NULL AND n.deleted_at IS NULL AND n.archived_at IS NULL",
    )
    .bind(project_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    for (id, title) in notes {
        push_neighbor(response, "note", id, title, None, "project", project_id, "note_mentions");
    }

    Ok(())
}

async fn expand_event(
    pool: &PgPool,
    user_id: &str,
    event_id: &str,
    response: &mut EntityGraphResponse,
) -> Result<(), (StatusCode, String)> {
    let row: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT contact_id, project_id FROM event WHERE id = $1 AND user_id = $2",
    )
    .bind(event_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let (contact_id, project_id) = row.unwrap_or((None, None));

    if let Some(cid) = contact_id {
        let nickname: Option<String> = sqlx::query_scalar(
            "SELECT nickname FROM contact WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
        )
        .bind(&cid)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if let Some(label) = nickname {
            push_neighbor(response, "contact", cid, label, None, "event", event_id, "event_attendee");
        }
    }

    if let Some(pid) = project_id {
        let title: Option<String> = sqlx::query_scalar(
            "SELECT title FROM project WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND archived_at IS NULL",
        )
        .bind(&pid)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if let Some(label) = title {
            push_neighbor(response, "project", pid, label, None, "event", event_id, "event_for_project");
        }
    }

    let actions: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, title FROM action WHERE user_id = $1 AND deleted_at IS NULL AND archived_at IS NULL \
         AND id IN (SELECT action_id FROM interaction WHERE event_id = $2 AND action_id IS NOT NULL AND deleted_at IS NULL)",
    )
    .bind(user_id)
    .bind(event_id)
    .fetch_all(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    for (id, title) in actions {
        push_neighbor(response, "action", id, title, None, "event", event_id, "action_in_event");
    }

    let notes: Vec<(String, String)> = sqlx::query_as(
        "SELECT n.id, n.title FROM note_entity ne \
         JOIN note n ON n.id = ne.note_id \
         WHERE ne.entity_type = 'event' AND ne.entity_id = $1 AND ne.user_id = $2 \
           AND ne.deleted_at IS NULL AND n.deleted_at IS NULL AND n.archived_at IS NULL",
    )
    .bind(event_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    for (id, title) in notes {
        push_neighbor(response, "note", id, title, None, "event", event_id, "note_mentions");
    }

    Ok(())
}

async fn expand_action(
    pool: &PgPool,
    user_id: &str,
    action_id: &str,
    response: &mut EntityGraphResponse,
) -> Result<(), (StatusCode, String)> {
    let row: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT contact_id, project_id FROM action WHERE id = $1 AND user_id = $2",
    )
    .bind(action_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let (contact_id, project_id) = row.unwrap_or((None, None));

    if let Some(cid) = contact_id {
        let nickname: Option<String> = sqlx::query_scalar(
            "SELECT nickname FROM contact WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
        )
        .bind(&cid)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if let Some(label) = nickname {
            push_neighbor(response, "contact", cid, label, None, "action", action_id, "action_assignee");
        }
    }

    if let Some(pid) = project_id {
        let title: Option<String> = sqlx::query_scalar(
            "SELECT title FROM project WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND archived_at IS NULL",
        )
        .bind(&pid)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if let Some(label) = title {
            push_neighbor(response, "project", pid, label, None, "action", action_id, "action_for_project");
        }
    }

    let events: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, title FROM event WHERE user_id = $1 AND deleted_at IS NULL AND archived_at IS NULL \
         AND id IN (SELECT event_id FROM interaction WHERE action_id = $2 AND event_id IS NOT NULL AND deleted_at IS NULL)",
    )
    .bind(user_id)
    .bind(action_id)
    .fetch_all(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    for (id, title) in events {
        push_neighbor(response, "event", id, title, None, "action", action_id, "action_in_event");
    }

    let notes: Vec<(String, String)> = sqlx::query_as(
        "SELECT n.id, n.title FROM note_entity ne \
         JOIN note n ON n.id = ne.note_id \
         WHERE ne.entity_type = 'action' AND ne.entity_id = $1 AND ne.user_id = $2 \
           AND ne.deleted_at IS NULL AND n.deleted_at IS NULL AND n.archived_at IS NULL",
    )
    .bind(action_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    for (id, title) in notes {
        push_neighbor(response, "note", id, title, None, "action", action_id, "note_mentions");
    }

    Ok(())
}

async fn expand_note(
    pool: &PgPool,
    user_id: &str,
    note_id: &str,
    response: &mut EntityGraphResponse,
) -> Result<(), (StatusCode, String)> {
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT entity_type, entity_id, entity_id FROM note_entity \
         WHERE note_id = $1 AND user_id = $2 AND deleted_at IS NULL",
    )
    .bind(note_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    for (entity_type, entity_id, _) in rows {
        let label_opt: Option<String> = match entity_type.as_str() {
            "contact" => sqlx::query_scalar(
                "SELECT nickname FROM contact WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
            )
            .bind(&entity_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            "project" => sqlx::query_scalar(
                "SELECT title FROM project WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND archived_at IS NULL",
            )
            .bind(&entity_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            "event" => sqlx::query_scalar(
                "SELECT title FROM event WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND archived_at IS NULL",
            )
            .bind(&entity_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            "action" => sqlx::query_scalar(
                "SELECT title FROM action WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND archived_at IS NULL",
            )
            .bind(&entity_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            _ => None,
        };
        let entity_type_static: &'static str = match entity_type.as_str() {
            "contact" => "contact",
            "project" => "project",
            "event" => "event",
            "action" => "action",
            _ => continue,
        };
        if let Some(label) = label_opt {
            push_neighbor(
                response,
                entity_type_static,
                entity_id,
                label,
                None,
                "note",
                note_id,
                "note_mentions",
            );
        }
    }

    Ok(())
}
