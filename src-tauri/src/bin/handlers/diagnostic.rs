use axum::Json;
use serde::Serialize;
use weavine_lib::models::LocalUser;

#[derive(Serialize)]
pub struct StartupInfo {
    pub server_ready: bool,
    pub error: Option<String>,
}

pub async fn user() -> Json<LocalUser> {
    Json(LocalUser {
        id: "default-user".into(),
        name: Some("Local User".into()),
        email: None,
    })
}

pub async fn startup() -> Json<StartupInfo> {
    Json(StartupInfo {
        server_ready: true,
        error: None,
    })
}
