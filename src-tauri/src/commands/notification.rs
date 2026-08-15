use chrono::{DateTime, Utc};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

const GRACE_PERIOD_SECS: i64 = 5;

#[derive(serde::Deserialize)]
pub struct ScheduleArgs {
    pub trigger_at: String,
    pub title: String,
    pub body: String,
    pub tag: String,
}

fn reminder_payload(r: &crate::models::Reminder) -> (String, String, String) {
    let title = r.summary();
    let body = match r.contact_nickname.as_deref() {
        Some(n) => format!("{n} · {title}"),
        None => title.clone(),
    };
    let tag = format!("reminder-{}", r.id);
    (title, body, tag)
}

fn fire(app: &AppHandle, title: &str, body: &str) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| format!("notification show failed: {e}"))
}

#[tauri::command]
pub fn fire_notification(app: AppHandle, title: String, body: String, _tag: String) -> Result<(), String> {
    fire(&app, &title, &body)
}

#[tauri::command]
pub fn schedule_notification(app: AppHandle, args: ScheduleArgs) -> Result<(), String> {
    let trigger = DateTime::parse_from_rfc3339(&args.trigger_at)
        .map_err(|e| format!("trigger_at parse: {e}"))?
        .with_timezone(&Utc);
    let now = Utc::now();
    let delay = (trigger - now).num_seconds();

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        if delay > GRACE_PERIOD_SECS {
            tokio::time::sleep(Duration::from_secs((delay - GRACE_PERIOD_SECS) as u64)).await;
        }
        let db = app_clone.state::<crate::db::Database>();
        let due = {
            let conn = match db.conn.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            match crate::business::reminder::claim_due_reminders(&conn) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("[notification] claim_due_reminders failed: {e}");
                    return;
                }
            }
        };
        for r in &due {
            let (title, body, _tag) = reminder_payload(r);
            let _ = fire(&app_clone, &title, &body);
            let _ = app_clone.emit("weavine:reminder-fired", r);
        }
    });

    Ok(())
}

pub fn schedule_for_reminder(app: &AppHandle, r: &crate::models::Reminder) {
    let (title, body, tag) = reminder_payload(r);
    let _ = schedule_notification(
        app.clone(),
        ScheduleArgs {
            trigger_at: r.trigger_at.clone(),
            title,
            body,
            tag,
        },
    );
}

pub fn startup_catch_up(app: &AppHandle, db: &crate::db::Database) {
    use crate::business::reminder;
    let pending = {
        let conn = match db.conn.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        match reminder::list_pending(&conn) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("[notification] startup list_pending failed: {e}");
                return;
            }
        }
    };
    eprintln!("[notification] catch-up scheduling {} reminders", pending.len());
    for r in pending {
        schedule_for_reminder(app, &r);
    }
}