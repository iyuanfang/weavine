use serde::Serialize;

#[derive(Serialize)]
pub struct StartupInfo {
    pub server_ready: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub fn get_startup_info() -> StartupInfo {
    let error = crate::STARTUP_ERROR.get().map(|s| s.clone());
    StartupInfo {
        server_ready: crate::SERVER_READY.load(std::sync::atomic::Ordering::SeqCst),
        error,
    }
}
