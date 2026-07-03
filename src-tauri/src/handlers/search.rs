use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use crate::AppState;
use weavine_lib::{business, models::SearchResults};

#[derive(Deserialize)]
pub struct SearchParams {
    pub owner_id: String,
    pub query: String,
    pub limit: Option<i64>,
}

pub async fn query(
    State(s): State<AppState>,
    Query(p): Query<SearchParams>,
) -> Result<Json<SearchResults>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::search::search(&conn, &p.owner_id, &p.query, p.limit)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}
