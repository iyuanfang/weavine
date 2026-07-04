use crate::business;
use crate::db::Database;
use crate::models::*;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListProjectsParams {
    pub owner_id: String,
    pub template: Option<String>,
    pub stage: Option<String>,
    pub archived: Option<String>,
    pub limit: Option<i64>,
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_projects(
    db: State<Database>,
    params: ListProjectsParams,
) -> Result<Vec<Project>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::project::list(
        &conn,
        &params.owner_id,
        params.template.as_deref(),
        params.stage.as_deref(),
        params.archived.as_deref(),
        params.limit,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_project(
    db: State<Database>,
    input: CreateProjectInput,
) -> Result<Project, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::project::create(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_project(
    db: State<Database>,
    input: UpdateProjectInput,
) -> Result<Project, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::project::update(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_project(db: State<Database>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::project::delete(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_project(db: State<Database>, id: String) -> Result<Project, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::project::get(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_project_stages(template: String) -> Result<Vec<String>, String> {
    business::project::list_stages(&template)
}
