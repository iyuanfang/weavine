use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use crate::AppState;
use weavine_lib::{
    business,
    commands::action::{CreateActionInput, UpdateActionInput},
    models::Action,
};

#[derive(Deserialize)]
pub struct ListParams {
    pub owner_id: String,
    pub status: Option<String>,
    pub contact_id: Option<String>,
    pub limit: Option<i64>,
}

pub async fn list(
    State(s): State<AppState>,
    Query(p): Query<ListParams>,
) -> Result<Json<Vec<Action>>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::action::list(
        &conn,
        &p.owner_id,
        p.status.as_deref(),
        p.contact_id.as_deref(),
        p.limit,
    )
    .map(Json)
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub async fn create(
    State(s): State<AppState>,
    Json(input): Json<CreateActionInput>,
) -> Result<Json<Action>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::action::create(&conn, &input)
        .map(Json)
        .map_err(|e| crate::handlers::http_err::for_create_or_update(&e))
}

pub async fn get(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Action>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::action::get(&conn, &id)
        .map(Json)
        .map_err(|e| crate::handlers::http_err::for_get(&e))
}

pub async fn update(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(mut input): Json<UpdateActionInput>,
) -> Result<Json<Action>, (StatusCode, String)> {
    input.id = id;
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::action::update(&conn, &input)
        .map(Json)
        .map_err(|e| crate::handlers::http_err::for_create_or_update(&e))
}

pub async fn delete(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<()>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::action::delete(&conn, &id)
        .map(|_| Json(()))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}
