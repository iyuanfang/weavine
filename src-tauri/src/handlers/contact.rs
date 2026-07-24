use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use crate::AppState;
use weavine_lib::{
    business,
    models::{Contact, CreateContactInput, ListContactsParams, UpdateContactInput, DEFAULT_CONTACT_LIMIT, DEFAULT_CONTACT_SORT},
};

#[derive(Deserialize)]
pub struct ListParams {
    pub user_id: String,
    pub tag_id: Option<String>,
    pub search: Option<String>,
    pub importance: Option<String>,
    pub sort_by: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

pub async fn list(
    State(s): State<AppState>,
    Query(p): Query<ListParams>,
) -> Result<Json<(Vec<Contact>, i64)>, (StatusCode, String)> {
    let params = ListContactsParams {
        user_id: p.user_id,
        tag_id: p.tag_id,
        search: p.search,
        importance: p.importance,
        sort_by: p.sort_by.unwrap_or_else(|| DEFAULT_CONTACT_SORT.to_string()),
        limit: p.limit.unwrap_or(DEFAULT_CONTACT_LIMIT),
        offset: p.offset.unwrap_or(0),
    };
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::contact::list(&conn, &params)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub async fn create(
    State(s): State<AppState>,
    Json(input): Json<CreateContactInput>,
) -> Result<Json<Contact>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::contact::create(&conn, &input)
        .map(Json)
        .map_err(|e| crate::handlers::http_err::for_create_or_update(&e))
}

pub async fn get(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Contact>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::contact::get(&conn, &id)
        .map(Json)
        .map_err(|e| crate::handlers::http_err::for_get(&e))
}

pub async fn update(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(mut input): Json<UpdateContactInput>,
) -> Result<Json<Contact>, (StatusCode, String)> {
    input.id = id;
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::contact::update(&conn, &input)
        .map(Json)
        .map_err(|e| crate::handlers::http_err::for_create_or_update(&e))
}

pub async fn delete(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<()>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::contact::delete(&conn, &id)
        .map(|_| Json(()))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}
