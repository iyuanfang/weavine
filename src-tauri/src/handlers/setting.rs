use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use crate::AppState;
use weavine_lib::{business, models::Setting};

#[derive(Deserialize)]
pub struct ListParams {
    pub user_id: String,
}

#[derive(Deserialize)]
pub struct UpsertBody {
    pub user_id: String,
    pub key: String,
    pub value: String,
}

#[derive(Deserialize)]
pub struct DeleteParams {
    pub user_id: String,
    pub key: String,
}

pub async fn list(
    State(s): State<AppState>,
    Query(p): Query<ListParams>,
) -> Result<Json<Vec<Setting>>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::setting::list(&conn, &p.user_id)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub async fn upsert(
    State(s): State<AppState>,
    Json(body): Json<UpsertBody>,
) -> Result<Json<Setting>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::setting::upsert(&conn, &body.user_id, &body.key, &body.value)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub async fn delete(
    State(s): State<AppState>,
    Query(p): Query<DeleteParams>,
) -> Result<Json<()>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::setting::delete(&conn, &p.user_id, &p.key)
        .map(|_| Json(()))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}
