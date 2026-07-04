use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use crate::AppState;
use weavine_lib::{
    business,
    models::{CreateInteractionInput, Interaction, UpdateInteractionInput},
};

#[derive(Deserialize)]
pub struct ListParams {
    pub user_id: String,
    pub contact_id: Option<String>,
    pub action_id: Option<String>,
    pub event_id: Option<String>,
    pub limit: Option<i64>,
}

pub async fn list(
    State(s): State<AppState>,
    Query(p): Query<ListParams>,
) -> Result<Json<Vec<Interaction>>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::interaction::list(
        &conn,
        &p.user_id,
        p.contact_id.as_deref(),
        p.action_id.as_deref(),
        p.event_id.as_deref(),
        p.limit,
    )
    .map(Json)
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub async fn create(
    State(s): State<AppState>,
    Json(input): Json<CreateInteractionInput>,
) -> Result<Json<Interaction>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::interaction::create(&conn, &input)
        .map(Json)
        .map_err(|e| crate::handlers::http_err::for_create_or_update(&e))
}

pub async fn get(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Interaction>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::interaction::get(&conn, &id)
        .map(Json)
        .map_err(|e| crate::handlers::http_err::for_get(&e))
}

pub async fn update(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(mut input): Json<UpdateInteractionInput>,
) -> Result<Json<Interaction>, (StatusCode, String)> {
    input.id = id;
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::interaction::update(&conn, &input)
        .map(Json)
        .map_err(|e| crate::handlers::http_err::for_create_or_update(&e))
}

pub async fn delete(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<()>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::interaction::delete(&conn, &id)
        .map(|_| Json(()))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}
