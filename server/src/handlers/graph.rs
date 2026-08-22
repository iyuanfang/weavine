use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;

use super::auth::extract_auth;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct GraphNode {
    pub id: String,
    pub nickname: Option<String>,
    pub name: Option<String>,
    pub company: Option<String>,
    pub title: Option<String>,
    pub importance: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_storage_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_mime: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GraphEdge {
    pub from_id: String,
    pub to_id: String,
    pub relation_type: String,
    pub role: Option<String>,
    pub label: Option<String>,
    pub depth: i32,
}

#[derive(Debug, Serialize)]
pub struct GraphResponse {
    pub center_id: String,
    pub depth: i32,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Deserialize)]
pub struct GraphParams {
    pub depth: Option<i32>,
}

pub async fn get(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(contact_id): Path<String>,
    Query(p): Query<GraphParams>,
) -> Result<Json<GraphResponse>, (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    let max_depth = p.depth.unwrap_or(2).clamp(1, 4);

    let rows: Vec<(String, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        r#"
        WITH RECURSIVE reachable(id, depth) AS (
            SELECT $1::text, 0
            UNION
            SELECT
                CASE WHEN el.from_id = r.id THEN el.to_id ELSE el.from_id END,
                r.depth + 1
            FROM reachable r
            JOIN entity_links el
              ON (el.from_id = r.id AND el.from_type = 'contact')
                 OR (el.to_id = r.id AND el.to_type = 'contact')
            WHERE el.relation_type = 'knows'
              AND el.user_id = $2
              AND r.depth < $3
        )
        SELECT DISTINCT r.id, c.nickname, c.name, c.company, c.title,
               c.avatar_storage_key, c.avatar_mime
        FROM reachable r
        JOIN contact c ON c.id = r.id AND c.user_id = $2
        "#,
    )
    .bind(&contact_id)
    .bind(&auth)
    .bind(max_depth)
    .fetch_all(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let nodes: Vec<GraphNode> = rows
        .into_iter()
        .map(|(id, nickname, name, company, title, avatar_storage_key, avatar_mime)| GraphNode {
            id,
            nickname,
            name,
            company,
            title,
            importance: None,
            avatar_storage_key,
            avatar_mime,
        })
        .collect();

    let edge_rows: Vec<(String, String, String, Option<String>, Option<String>, i32)> = sqlx::query_as(
        r#"
        WITH RECURSIVE reachable(id, depth) AS (
            SELECT $1::text, 0
            UNION
            SELECT
                CASE WHEN el.from_id = r.id THEN el.to_id ELSE el.from_id END,
                r.depth + 1
            FROM reachable r
            JOIN entity_links el
              ON (el.from_id = r.id AND el.from_type = 'contact')
                 OR (el.to_id = r.id AND el.to_type = 'contact')
            WHERE el.relation_type = 'knows'
              AND el.user_id = $2
              AND r.depth < $3
        ),
        edge_hits AS (
            SELECT el.from_id, el.to_id, el.relation_type, el.role, el.label, MIN(r.depth) AS min_depth
            FROM entity_links el
            JOIN reachable r
              ON (el.from_id = r.id AND el.from_type = 'contact')
                 OR (el.to_id = r.id AND el.to_type = 'contact')
            WHERE el.relation_type = 'knows'
              AND el.user_id = $2
              AND r.depth > 0
            GROUP BY el.from_id, el.to_id, el.relation_type, el.role, el.label
        )
        SELECT from_id, to_id, relation_type, role, label, min_depth
        FROM edge_hits
        "#,
    )
    .bind(&contact_id)
    .bind(&auth)
    .bind(max_depth)
    .fetch_all(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let edges: Vec<GraphEdge> = edge_rows
        .into_iter()
        .map(|(from_id, to_id, relation_type, role, label, depth)| GraphEdge {
            from_id,
            to_id,
            relation_type,
            role,
            label,
            depth,
        })
        .collect();

    Ok(Json(GraphResponse {
        center_id: contact_id,
        depth: max_depth,
        nodes,
        edges,
    }))
}

pub async fn add_relation(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(contact_id): Path<String>,
    Json(body): Json<AddRelationInput>,
) -> Result<Json<GraphEdge>, (StatusCode, String)> {
    let (auth, device_id) = super::auth::extract_auth_with_device(&headers, pool.as_ref()).await?;
    let id = uuid::Uuid::new_v4().to_string();
    let relation_type = body.relation_type.as_deref().unwrap_or("knows");
    let role = body.role.as_deref();

    let (from_id, to_id) = if contact_id <= body.other_contact_id {
        (&contact_id, &body.other_contact_id)
    } else {
        (&body.other_contact_id, &contact_id)
    };

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
        .bind(&device_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query(
        "INSERT INTO entity_links (id, user_id, from_type, from_id, to_type, to_id, relation_type, role, label) \
         VALUES ($1, $2, 'contact', $3, 'contact', $4, $5, COALESCE($6, 'contact'), $7) \
         ON CONFLICT (user_id, from_type, from_id, to_type, to_id, relation_type) \
         DO UPDATE SET role = EXCLUDED.role, label = EXCLUDED.label"
    )
    .bind(&id)
    .bind(&auth)
    .bind(from_id)
    .bind(to_id)
    .bind(relation_type)
    .bind(role)
    .bind(&body.label)
    .execute(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(GraphEdge {
        from_id: from_id.clone(),
        to_id: to_id.clone(),
        relation_type: relation_type.to_string(),
        role: role.map(str::to_string),
        label: body.label,
        depth: 1,
    }))
}

#[derive(Deserialize)]
pub struct AddRelationInput {
    pub other_contact_id: String,
    pub relation_type: Option<String>,
    pub role: Option<String>,
    pub label: Option<String>,
}

pub async fn remove_relation(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path((contact_id, other_id)): Path<(String, String)>,
) -> Result<(StatusCode, ()), (StatusCode, String)> {
    let (auth, device_id) = super::auth::extract_auth_with_device(&headers, pool.as_ref()).await?;
    let (from_id, to_id) = if contact_id <= other_id {
        (&contact_id, &other_id)
    } else {
        (&other_id, &contact_id)
    };
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
        .bind(&device_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    sqlx::query(
        "DELETE FROM entity_links WHERE user_id=$1 AND relation_type='knows' \
         AND from_type='contact' AND from_id=$2 AND to_id=$3"
    )
    .bind(&auth)
    .bind(from_id)
    .bind(to_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok((StatusCode::NO_CONTENT, ()))
}