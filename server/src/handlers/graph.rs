use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Serialize;
use sqlx::PgPool;
use std::collections::HashSet;
use std::sync::Arc;

use super::auth::extract_auth;

type OptStr = Option<String>;
// (contact_id, contact_label, project_id, project_label) — all nullable.
type MainLabels = (OptStr, OptStr, OptStr, OptStr);
// (contact_id, contact_label, action_id, action_label, event_id, event_label) — all nullable.
type InteractionLabels = (OptStr, OptStr, OptStr, OptStr, OptStr, OptStr);

pub const SUPPORTED_ENTITY_TYPES: &[&str] = &["contact", "project", "event", "action", "note", "interaction", "tag"];

#[derive(Debug, Serialize)]
pub struct EntityGraphNode {
    pub id: String,
    pub entity_type: &'static str,
    pub label: String,
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
    pub nodes: Vec<EntityGraphNode>,
    pub edges: Vec<EntityGraphEdge>,
    // Dedup cache for push_neighbor — keyed on (from_type, from_id, to_type, to_id).
    // Never serialized; the wire shape is unchanged from the caller's POV.
    #[serde(skip)]
    pub seen: HashSet<(String, String, String, String)>,
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
        nodes: Vec::new(),
        edges: Vec::new(),
        seen: HashSet::new(),
    };

    response.nodes.push(load_center_node(&pool, &auth, &entity_type, &entity_id).await?);

    match entity_type.as_str() {
        "contact" => expand_contact(&pool, &auth, &entity_id, &mut response).await?,
        "project" => expand_project(&pool, &auth, &entity_id, &mut response).await?,
        "event" => expand_event(&pool, &auth, &entity_id, &mut response).await?,
        "action" => expand_action(&pool, &auth, &entity_id, &mut response).await?,
        "note" => expand_note(&pool, &auth, &entity_id, &mut response).await?,
        "interaction" => expand_interaction(&pool, &auth, &entity_id, &mut response).await?,
        "tag" => expand_tag(&pool, &auth, &entity_id, &mut response).await?,
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
            "SELECT id, nickname FROM contact WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND archived_at IS NULL",
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
        "interaction" => sqlx::query_as(
            "SELECT id, summary FROM interaction WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
        )
        .bind(entity_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        "tag" => sqlx::query_as(
            "SELECT id, name FROM tag WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
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
        "interaction" => "interaction",
        "tag" => "tag",
        _ => unreachable!(),
    };
    Ok(EntityGraphNode {
        id,
        entity_type: entity_type_static,
        label: label.unwrap_or_else(|| "(untitled)".to_string()),
        is_center: true,
    })
}

/// Append a neighbor node + its edge, deduping on (from_type, from_id, to_type, to_id)
/// via the `seen` HashSet on the response. O(1) lookup replaces the old linear
/// `edges.iter().any(...)` scan. The `relation` string semantics are unchanged.
fn push_neighbor(
    response: &mut EntityGraphResponse,
    entity_type: &'static str,
    id: String,
    label: String,
    from_type: &str,
    from_id: &str,
    relation: &str,
) {
    let key = (
        from_type.to_string(),
        from_id.to_string(),
        entity_type.to_string(),
        id.clone(),
    );
    if !response.seen.insert(key) {
        return;
    }
    response.nodes.push(EntityGraphNode {
        id: id.clone(),
        entity_type,
        label,
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
    // 5 independent queries run concurrently; each preserves its user_id check
    // and deleted_at/archived_at filters exactly as before.
    let (projects, events, actions, interactions, notes) = tokio::try_join!(
        async {
            let rows: Vec<(String, String)> = sqlx::query_as(
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
            Ok::<_, (StatusCode, String)>(rows)
        },
        async {
            let rows: Vec<(String, String)> = sqlx::query_as(
                "SELECT id, title FROM event WHERE contact_id = $1 AND user_id = $2 \
                   AND deleted_at IS NULL AND archived_at IS NULL",
            )
            .bind(contact_id)
            .bind(user_id)
            .fetch_all(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            Ok::<_, (StatusCode, String)>(rows)
        },
        async {
            let rows: Vec<(String, String)> = sqlx::query_as(
                "SELECT id, title FROM action WHERE contact_id = $1 AND user_id = $2 \
                   AND deleted_at IS NULL AND archived_at IS NULL",
            )
            .bind(contact_id)
            .bind(user_id)
            .fetch_all(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            Ok::<_, (StatusCode, String)>(rows)
        },
        async {
            let rows: Vec<(String, String)> = sqlx::query_as(
                "SELECT id, summary FROM interaction WHERE contact_id = $1 AND user_id = $2 \
                   AND deleted_at IS NULL",
            )
            .bind(contact_id)
            .bind(user_id)
            .fetch_all(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            Ok::<_, (StatusCode, String)>(rows)
        },
        async {
            let rows: Vec<(String, String)> = sqlx::query_as(
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
            Ok::<_, (StatusCode, String)>(rows)
        },
    )?;

    for (id, title) in projects {
        push_neighbor(response, "project", id, title, "contact", contact_id, "project_member");
    }
    for (id, title) in events {
        push_neighbor(response, "event", id, title, "contact", contact_id, "event_attendee");
    }
    for (id, title) in actions {
        push_neighbor(response, "action", id, title, "contact", contact_id, "action_assignee");
    }
    for (id, summary) in interactions {
        push_neighbor(response, "interaction", id, summary, "contact", contact_id, "has_interaction");
    }
    for (id, title) in notes {
        push_neighbor(response, "note", id, title, "contact", contact_id, "note_mentions");
    }

    // Tag neighbors intentionally omitted: GraphView UI redesign (2e7bbe4) dropped
    // tag nodes from the client. Keeping the server emit would only crash the SPA
    // (entity_type="tag" not in TYPE_META). The contact <-> tag relationship
    // remains queryable via /api/contacts/:id/tags.

    Ok(())
}

async fn expand_project(
    pool: &PgPool,
    user_id: &str,
    project_id: &str,
    response: &mut EntityGraphResponse,
) -> Result<(), (StatusCode, String)> {
    let (contacts, events, actions, notes) = tokio::try_join!(
        async {
            let rows: Vec<(String, String)> = sqlx::query_as(
                "SELECT c.id, c.nickname FROM project_contact pc \
                 JOIN contact c ON c.id = pc.contact_id \
                 WHERE pc.project_id = $1 AND pc.user_id = $2 AND c.deleted_at IS NULL AND c.archived_at IS NULL",
            )
            .bind(project_id)
            .bind(user_id)
            .fetch_all(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            Ok::<_, (StatusCode, String)>(rows)
        },
        async {
            let rows: Vec<(String, String)> = sqlx::query_as(
                "SELECT id, title FROM event WHERE project_id = $1 AND user_id = $2 \
                   AND deleted_at IS NULL AND archived_at IS NULL",
            )
            .bind(project_id)
            .bind(user_id)
            .fetch_all(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            Ok::<_, (StatusCode, String)>(rows)
        },
        async {
            let rows: Vec<(String, String)> = sqlx::query_as(
                "SELECT id, title FROM action WHERE project_id = $1 AND user_id = $2 \
                   AND deleted_at IS NULL AND archived_at IS NULL",
            )
            .bind(project_id)
            .bind(user_id)
            .fetch_all(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            Ok::<_, (StatusCode, String)>(rows)
        },
        async {
            let rows: Vec<(String, String)> = sqlx::query_as(
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
            Ok::<_, (StatusCode, String)>(rows)
        },
    )?;

    for (id, nickname) in contacts {
        push_neighbor(response, "contact", id, nickname, "project", project_id, "project_member");
    }
    for (id, title) in events {
        push_neighbor(response, "event", id, title, "project", project_id, "event_for_project");
    }
    for (id, title) in actions {
        push_neighbor(response, "action", id, title, "project", project_id, "action_for_project");
    }
    for (id, title) in notes {
        push_neighbor(response, "note", id, title, "project", project_id, "note_mentions");
    }

    Ok(())
}

async fn expand_event(
    pool: &PgPool,
    user_id: &str,
    event_id: &str,
    response: &mut EntityGraphResponse,
) -> Result<(), (StatusCode, String)> {
    let (main, participants, actions, interactions, notes) = tokio::try_join!(
        async {
            let row: Option<MainLabels> = sqlx::query_as(
                "SELECT e.contact_id, c.nickname AS contact_label, \
                        e.project_id, p.title    AS project_label \
                 FROM event e \
                 LEFT JOIN contact c ON c.id = e.contact_id AND c.user_id = e.user_id \
                       AND c.deleted_at IS NULL AND c.archived_at IS NULL \
                 LEFT JOIN project p ON p.id = e.project_id AND p.user_id = e.user_id \
                       AND p.deleted_at IS NULL AND p.archived_at IS NULL \
                 WHERE e.id = $1 AND e.user_id = $2",
            )
            .bind(event_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            Ok::<_, (StatusCode, String)>(row)
        },
        async {
            let rows: Vec<(String, Option<String>)> = sqlx::query_as(
                "SELECT el.to_id AS contact_id, c.nickname \
                 FROM entity_links el \
                 LEFT JOIN contact c ON c.id = el.to_id AND c.user_id = el.user_id \
         WHERE el.from_type='event' AND el.from_id=$1 AND el.relation_type='participated' \
           AND c.deleted_at IS NULL AND c.archived_at IS NULL AND el.user_id = $2 \
         ORDER BY el.created_at ASC",
    )
    .bind(event_id)
    .bind(user_id)
    .fetch_all(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            Ok::<_, (StatusCode, String)>(rows)
        },
        async {
            let rows: Vec<(String, String)> = sqlx::query_as(
                "SELECT id, title FROM action WHERE user_id = $1 AND deleted_at IS NULL AND archived_at IS NULL \
                 AND id IN (SELECT action_id FROM interaction WHERE event_id = $2 AND action_id IS NOT NULL AND deleted_at IS NULL)",
            )
            .bind(user_id)
            .bind(event_id)
            .fetch_all(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            Ok::<_, (StatusCode, String)>(rows)
        },
        async {
            let rows: Vec<(String, String)> = sqlx::query_as(
                "SELECT id, summary FROM interaction WHERE event_id = $1 AND user_id = $2 \
                   AND deleted_at IS NULL",
            )
            .bind(event_id)
            .bind(user_id)
            .fetch_all(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            Ok::<_, (StatusCode, String)>(rows)
        },
        async {
            let rows: Vec<(String, String)> = sqlx::query_as(
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
            Ok::<_, (StatusCode, String)>(rows)
        },
    )?;

    let (contact_id, contact_label, project_id, project_label) =
        main.unwrap_or((None, None, None, None));

    if let (Some(cid), Some(label)) = (contact_id, contact_label) {
        push_neighbor(response, "contact", cid, label, "event", event_id, "event_attendee");
    }
    for (cid, nickname_opt) in participants {
        if let Some(label) = nickname_opt {
            push_neighbor(response, "contact", cid, label, "event", event_id, "event_attendee");
        }
    }
    if let (Some(pid), Some(label)) = (project_id, project_label) {
        push_neighbor(response, "project", pid, label, "event", event_id, "event_for_project");
    }
    for (id, title) in actions {
        push_neighbor(response, "action", id, title, "event", event_id, "action_in_event");
    }
    for (id, summary) in interactions {
        push_neighbor(response, "interaction", id, summary, "event", event_id, "event_has_interaction");
    }
    for (id, title) in notes {
        push_neighbor(response, "note", id, title, "event", event_id, "note_mentions");
    }

    Ok(())
}

async fn expand_action(
    pool: &PgPool,
    user_id: &str,
    action_id: &str,
    response: &mut EntityGraphResponse,
) -> Result<(), (StatusCode, String)> {
    // Primary contact_id + nickname and primary project_id + title folded into
    // the initial SELECT via LEFT JOINs; the remaining queries (events via
    // interaction, interactions, notes) key off action_id directly.
    let (main, events, interactions, notes) = tokio::try_join!(
        async {
            let row: Option<MainLabels> = sqlx::query_as(
                "SELECT a.contact_id, c.nickname AS contact_label, \
                        a.project_id, p.title    AS project_label \
                 FROM action a \
                 LEFT JOIN contact c ON c.id = a.contact_id AND c.user_id = a.user_id \
                       AND c.deleted_at IS NULL AND c.archived_at IS NULL \
                 LEFT JOIN project p ON p.id = a.project_id AND p.user_id = a.user_id \
                       AND p.deleted_at IS NULL AND p.archived_at IS NULL \
                 WHERE a.id = $1 AND a.user_id = $2",
            )
            .bind(action_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            Ok::<_, (StatusCode, String)>(row)
        },
        async {
            let rows: Vec<(String, String)> = sqlx::query_as(
                "SELECT id, title FROM event WHERE user_id = $1 AND deleted_at IS NULL AND archived_at IS NULL \
                 AND id IN (SELECT event_id FROM interaction WHERE action_id = $2 AND event_id IS NOT NULL AND deleted_at IS NULL)",
            )
            .bind(user_id)
            .bind(action_id)
            .fetch_all(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            Ok::<_, (StatusCode, String)>(rows)
        },
        async {
            let rows: Vec<(String, String)> = sqlx::query_as(
                "SELECT id, summary FROM interaction WHERE action_id = $1 AND user_id = $2 \
                   AND deleted_at IS NULL",
            )
            .bind(action_id)
            .bind(user_id)
            .fetch_all(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            Ok::<_, (StatusCode, String)>(rows)
        },
        async {
            let rows: Vec<(String, String)> = sqlx::query_as(
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
            Ok::<_, (StatusCode, String)>(rows)
        },
    )?;

    let (contact_id, contact_label, project_id, project_label) =
        main.unwrap_or((None, None, None, None));

    if let (Some(cid), Some(label)) = (contact_id, contact_label) {
        push_neighbor(response, "contact", cid, label, "action", action_id, "action_assignee");
    }
    if let (Some(pid), Some(label)) = (project_id, project_label) {
        push_neighbor(response, "project", pid, label, "action", action_id, "action_for_project");
    }
    for (id, title) in events {
        push_neighbor(response, "event", id, title, "action", action_id, "action_in_event");
    }
    for (id, summary) in interactions {
        push_neighbor(response, "interaction", id, summary, "action", action_id, "action_has_interaction");
    }
    for (id, title) in notes {
        push_neighbor(response, "note", id, title, "action", action_id, "note_mentions");
    }

    Ok(())
}

async fn expand_interaction(
    pool: &PgPool,
    user_id: &str,
    interaction_id: &str,
    response: &mut EntityGraphResponse,
) -> Result<(), (StatusCode, String)> {
    let (main, notes) = tokio::try_join!(
        async {
            let row: Option<InteractionLabels> = sqlx::query_as(
                "SELECT i.contact_id, c.nickname AS contact_label, \
                        i.action_id,  a.title    AS action_label, \
                        i.event_id,   e.title    AS event_label \
                 FROM interaction i \
                 LEFT JOIN contact c ON c.id = i.contact_id AND c.user_id = i.user_id \
                       AND c.deleted_at IS NULL AND c.archived_at IS NULL \
                 LEFT JOIN action  a ON a.id = i.action_id  AND a.user_id = i.user_id \
                       AND a.deleted_at IS NULL AND a.archived_at IS NULL \
                 LEFT JOIN event   e ON e.id = i.event_id   AND e.user_id = i.user_id \
                       AND e.deleted_at IS NULL AND e.archived_at IS NULL \
                 WHERE i.id = $1 AND i.user_id = $2 AND i.deleted_at IS NULL",
            )
            .bind(interaction_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            Ok::<_, (StatusCode, String)>(row)
        },
        async {
            let rows: Vec<(String, String)> = sqlx::query_as(
                "SELECT n.id, n.title FROM note_entity ne \
                 JOIN note n ON n.id = ne.note_id \
                 WHERE ne.entity_type = 'interaction' AND ne.entity_id = $1 AND ne.user_id = $2 \
                   AND ne.deleted_at IS NULL AND n.deleted_at IS NULL AND n.archived_at IS NULL",
            )
            .bind(interaction_id)
            .bind(user_id)
            .fetch_all(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            Ok::<_, (StatusCode, String)>(rows)
        },
    )?;

    let (contact_id, contact_label, action_id, action_label, event_id, event_label) =
        main.unwrap_or((None, None, None, None, None, None));

    if let (Some(cid), Some(label)) = (contact_id, contact_label) {
        push_neighbor(
            response,
            "contact",
            cid,
            label,
            "interaction",
            interaction_id,
            "interaction_with_contact",
        );
    }
    if let (Some(aid), Some(label)) = (action_id, action_label) {
        push_neighbor(
            response,
            "action",
            aid,
            label,
            "interaction",
            interaction_id,
            "interaction_via_action",
        );
    }
    if let (Some(eid), Some(label)) = (event_id, event_label) {
        push_neighbor(
            response,
            "event",
            eid,
            label,
            "interaction",
            interaction_id,
            "interaction_in_event",
        );
    }
    for (id, title) in notes {
        push_neighbor(
            response,
            "note",
            id,
            title,
            "interaction",
            interaction_id,
            "note_mentions",
        );
    }

    Ok(())
}

async fn expand_note(
    pool: &PgPool,
    user_id: &str,
    note_id: &str,
    response: &mut EntityGraphResponse,
) -> Result<(), (StatusCode, String)> {
    let rows: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT ne.entity_type, ne.entity_id, \
                COALESCE(c.nickname, p.title, e.title, a.title, i.summary) AS label \
         FROM note_entity ne \
         LEFT JOIN contact c ON c.id = ne.entity_id AND ne.entity_type='contact' \
               AND c.user_id = ne.user_id AND c.deleted_at IS NULL AND c.archived_at IS NULL \
         LEFT JOIN project p ON p.id = ne.entity_id AND ne.entity_type='project' \
               AND p.user_id = ne.user_id AND p.deleted_at IS NULL AND p.archived_at IS NULL \
         LEFT JOIN event e   ON e.id = ne.entity_id AND ne.entity_type='event' \
               AND e.user_id = ne.user_id AND e.deleted_at IS NULL AND e.archived_at IS NULL \
         LEFT JOIN action a   ON a.id = ne.entity_id AND ne.entity_type='action' \
               AND a.user_id = ne.user_id AND a.deleted_at IS NULL AND a.archived_at IS NULL \
         LEFT JOIN interaction i ON i.id = ne.entity_id AND ne.entity_type='interaction' \
               AND i.user_id = ne.user_id AND i.deleted_at IS NULL \
         WHERE ne.note_id = $1 AND ne.user_id = $2 AND ne.deleted_at IS NULL",
    )
    .bind(note_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    for (entity_type, entity_id, label_opt) in rows {
        let label = match label_opt {
            Some(l) => l,
            None => continue,
        };
        let entity_type_static: &'static str = match entity_type.as_str() {
            "contact" => "contact",
            "project" => "project",
            "event" => "event",
            "action" => "action",
            "interaction" => "interaction",
            _ => continue,
        };
        push_neighbor(
            response,
            entity_type_static,
            entity_id,
            label,
            "note",
            note_id,
            "note_mentions",
        );
    }

    Ok(())
}

async fn expand_tag(
    _pool: &PgPool,
    _user_id: &str,
    _tag_id: &str,
    _response: &mut EntityGraphResponse,
) -> Result<(), (StatusCode, String)> {
    // intentionally empty - UI dropped tag nodes (GraphView redesign 2e7bbe4).
    // The center node (the tag itself) is still loaded by load_center_node above;
    // neighbor emission is skipped because the SPA's TYPE_META no longer renders
    // "tag" graph nodes. Tag <-> contact membership remains queryable via
    // /api/tags/:id/contacts.
    Ok(())
}
