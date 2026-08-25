use crate::business;
use crate::business::graph::EntityGraphResponse;
use crate::db::Database;
use crate::models::EntityGraphInput;
use tauri::State;

#[tauri::command]
pub fn entity_graph(
    db: State<Database>,
    input: EntityGraphInput,
) -> Result<EntityGraphResponse, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::graph::entity_graph(&conn, &input.user_id, &input.entity_type, &input.entity_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("{} not found or not owned by user", input.entity_type))
}