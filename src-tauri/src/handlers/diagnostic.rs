use axum::{extract::State, http::StatusCode, Json};
use serde::Serialize;
use weavine_lib::models::LocalUser;

use crate::AppState;

#[derive(Serialize)]
pub struct StartupInfo {
    pub server_ready: bool,
    pub error: Option<String>,
}

pub async fn user(
    State(s): State<AppState>,
) -> Result<Json<LocalUser>, (StatusCode, String)> {
    let conn = s
        .db
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    weavine_lib::business::diagnostic::get_local_user(&conn)
        .map(Json)
        .map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))
}

pub async fn startup() -> Json<StartupInfo> {
    Json(StartupInfo {
        server_ready: true,
        error: None,
    })
}
