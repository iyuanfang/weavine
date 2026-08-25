use crate::business;
use crate::business::graph::EntityGraphResponse;
use crate::db::Database;
use tauri::State;

#[tauri::command(rename_all = "snake_case")]
pub fn entity_graph(
    db: State<Database>,
    user_id: String,
    entity_type: String,
    entity_id: String,
) -> Result<EntityGraphResponse, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::graph::entity_graph(&conn, &user_id, &entity_type, &entity_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("{} not found or not owned by user", entity_type))
}