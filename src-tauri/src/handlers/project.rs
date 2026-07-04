use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use crate::AppState;
use weavine_lib::{
    business,
    models::{CreateProjectInput, Project, UpdateProjectInput},
};

#[derive(Deserialize)]
pub struct ListParams {
    pub owner_id: String,
    pub template: Option<String>,
    pub stage: Option<String>,
    pub archived: Option<String>,
    pub limit: Option<i64>,
}

pub async fn list(
    State(s): State<AppState>,
    Query(p): Query<ListParams>,
) -> Result<Json<Vec<Project>>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::project::list(
        &conn,
        &p.owner_id,
        p.template.as_deref(),
        p.stage.as_deref(),
        p.archived.as_deref(),
        p.limit,
    )
    .map(Json)
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub async fn create(
    State(s): State<AppState>,
    Json(input): Json<CreateProjectInput>,
) -> Result<Json<Project>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::project::create(&conn, &input)
        .map(Json)
        .map_err(|e| crate::handlers::http_err::for_create_or_update(&e))
}

pub async fn get(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Project>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::project::get(&conn, &id)
        .map(Json)
        .map_err(|e| crate::handlers::http_err::for_get(&e))
}

pub async fn update(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(mut input): Json<UpdateProjectInput>,
) -> Result<Json<Project>, (StatusCode, String)> {
    input.id = id;
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::project::update(&conn, &input)
        .map(Json)
        .map_err(|e| crate::handlers::http_err::for_create_or_update(&e))
}

pub async fn delete(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<()>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::project::delete(&conn, &id)
        .map(|_| Json(()))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

#[derive(Deserialize)]
pub struct StagesParams {
    pub template: String,
}

pub async fn stages(
    State(_s): State<AppState>,
    Query(p): Query<StagesParams>,
) -> Result<Json<Vec<String>>, (StatusCode, String)> {
    business::project::list_stages(&p.template)
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))
}
