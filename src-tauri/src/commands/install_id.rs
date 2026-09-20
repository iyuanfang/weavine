use crate::install_id;

#[tauri::command]
pub fn get_install_id() -> String {
    install_id::get_or_create()
}