use rusqlite::Connection;

fn main() {
    let conn = Connection::open_in_memory().unwrap();
    weavine_lib::migration::run(&conn).unwrap();
    
    let tables: Vec<(String,)> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?,)))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    println!("Tables: {:?}", tables.iter().map(|t| &t.0).collect::<Vec<_>>());
    
    let events_count: i64 = conn.query_row("SELECT COUNT(*) FROM Event", [], |r| r.get(0)).unwrap();
    let tags_count: i64 = conn.query_row("SELECT COUNT(*) FROM \"Tag\"", [], |r| r.get(0)).unwrap();
    let users_count: i64 = conn.query_row("SELECT COUNT(*) FROM \"User\"", [], |r| r.get(0)).unwrap();
    let actions_count: i64 = conn.query_row("SELECT COUNT(*) FROM Action", [], |r| r.get(0)).unwrap();
    let event_cols: Vec<String> = conn.prepare("SELECT name FROM pragma_table_info('Event')").unwrap()
        .query_map([], |r| r.get(0)).unwrap().filter_map(|r| r.ok()).collect();
    let action_cols: Vec<String> = conn.prepare("SELECT name FROM pragma_table_info('Action')").unwrap()
        .query_map([], |r| r.get(0)).unwrap().filter_map(|r| r.ok()).collect();
    
    println!("Users: {users_count}, Tags: {tags_count}, Events: {events_count}, Actions: {actions_count}");
    println!("Event columns: {:?}", event_cols);
    println!("Action columns: {:?}", action_cols);
}
