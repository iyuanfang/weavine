// ── Field name filtering for sync ──
//
// Both SQLite and PG now use snake_case, so no name conversion is
// needed. We only strip PG-only columns (server_revision, deleted_at)
// when applying pulled data locally.

use serde_json::Value;

/// Identity — both schemas use snake_case.
pub fn obj_camel_to_snake(v: &Value) -> Value {
    v.clone()
}

/// Strip PG-only columns (server_revision, deleted_at) when pulling.
/// Keys are already snake_case; no name mapping needed.
pub fn obj_snake_to_camel(v: &Value) -> Value {
    match v {
        Value::Object(map) => {
            let mut out = serde_json::Map::with_capacity(map.len());
            for (k, val) in map {
                if k == "server_revision" || k == "deleted_at" { continue; }
                out.insert(k.clone(), obj_snake_to_camel(val));
            }
            Value::Object(out)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(obj_snake_to_camel).collect()),
        other => other.clone(),
    }
}

pub const ENTITY_KINDS: &[&str] = &[
    "contact", "tag", "event", "action", "interaction",
    "project", "reminder", "setting", "contact_tag", "project_contact",
];

pub const UPDATED_AT_TABLES: &[&str] = &[
    "contact", "project", "event", "action", "setting",
];

pub const JUNCTION_TABLES: &[&str] = &["contact_tag", "project_contact"];

pub fn sqlite_table_to_kind(table: &str) -> Option<&'static str> {
    match table {
        "Contact" => Some("contact"),
        "Tag" => Some("tag"),
        "Event" => Some("event"),
        "Action" => Some("action"),
        "Interaction" => Some("interaction"),
        "Project" => Some("project"),
        "Reminder" => Some("reminder"),
        "Setting" => Some("setting"),
        "ContactTag" => Some("contact_tag"),
        "ProjectContact" => Some("project_contact"),
        _ => None,
    }
}

pub fn kind_to_sqlite_table(kind: &str) -> Option<&'static str> {
    match kind {
        "contact" => Some("Contact"),
        "tag" => Some("Tag"),
        "event" => Some("Event"),
        "action" => Some("Action"),
        "interaction" => Some("Interaction"),
        "project" => Some("Project"),
        "reminder" => Some("Reminder"),
        "setting" => Some("Setting"),
        "contact_tag" => Some("ContactTag"),
        "project_contact" => Some("ProjectContact"),
        _ => None,
    }
}

pub fn push_columns(kind: &str) -> &'static [&'static str] {
    match kind {
        "contact" => &["id","user_id","nickname","name","company","title","city","email","phone","wechat","notes","importance","reminder_enabled","reminder_interval_days","last_contacted_at","created_at","updated_at"],
        "tag" => &["id","user_id","name","color","created_at"],
        "event" => &["id","user_id","title","event_type","start_at","end_at","location","notes","reminder_lead_minutes","contact_id","project_id","archived_at","created_at","updated_at"],
        "action" => &["id","user_id","title","description","status","priority","category","due_at","contact_id","project_id","completed_at","archived_at","created_at","updated_at"],
        "interaction" => &["id","user_id","contact_id","action_id","event_id","occurred_at","channel","summary","created_at"],
        "project" => &["id","user_id","title","description","template","stage","start_at","due_at","completed_at","archived_at","created_at","updated_at"],
        "reminder" => &["id","user_id","contact_id","event_id","trigger_at","kind","dispatched","dismissed","created_at"],
        "setting" => &["id","user_id","key","value","updated_at"],
        "contact_tag" => &["user_id","contact_id","tag_id"],
        "project_contact" => &["user_id","project_id","contact_id","role","added_at"],
        _ => &[],
    }
}

/// Generate a UUID for junction tables that PG requires but SQLite doesn't have.
pub fn add_junction_id(kind: &str, data: &mut serde_json::Map<String, Value>) {
    if JUNCTION_TABLES.contains(&kind) && !data.contains_key("id") {
        data.insert("id".into(), Value::String(uuid::Uuid::new_v4().to_string()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_obj_camel_to_snake_is_identity() {
        let input = json!({"user_id": "test", "created_at": "2026-01-01", "event_type": "meeting"});
        let out = obj_camel_to_snake(&input);
        // Both schemas use snake_case now — passthrough
        assert_eq!(out, input);
    }

    #[test]
    fn test_obj_snake_to_camel_skips_pg_only() {
        let input = json!({"user_id": "test", "server_revision": 42, "deleted_at": null});
        let out = obj_snake_to_camel(&input);
        // Keys stay snake_case (no name conversion needed), PG-only fields stripped
        assert_eq!(out["user_id"], "test");
        assert!(out.get("server_revision").is_none());
        assert!(out.get("deleted_at").is_none());
    }

    #[test]
    fn test_push_columns_are_snake_case() {
        for kind in ENTITY_KINDS {
            let cols = push_columns(kind);
            assert!(!cols.is_empty(), "{} has no columns", kind);
            for col in cols {
                assert!(!col.contains(char::is_uppercase), "{} column {} is not snake_case", kind, col);
            }
        }
    }
}
