use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use crate::AppState;
use weavine_lib::{business, models::ProjectContactWithContact};

#[derive(Deserialize)]
pub struct AddBody {
    pub contact_id: String,
    pub role: Option<String>,
}

pub async fn list(
    State(s): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Vec<ProjectContactWithContact>>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::project_contact::list_contacts_for_project(&conn, &project_id)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub async fn add(
    State(s): State<AppState>,
    Path(project_id): Path<String>,
    Json(body): Json<AddBody>,
) -> Result<Json<()>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::project_contact::add(&conn, &project_id, &body.contact_id, body.role.as_deref())
        .map(|_| Json(()))
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

pub async fn remove(
    State(s): State<AppState>,
    Path((project_id, contact_id)): Path<(String, String)>,
) -> Result<Json<()>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::project_contact::remove(&conn, &project_id, &contact_id)
        .map(|_| Json(()))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}