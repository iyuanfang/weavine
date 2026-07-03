use std::time::Duration;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;
use tokio::time::interval;

use crate::db::Database;
use crate::business::reminder as reminder_biz;

const POLL_INTERVAL_SECS: u64 = 30;

pub fn start_reminder_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = interval(Duration::from_secs(POLL_INTERVAL_SECS));
        ticker.tick().await;
        loop {
            ticker.tick().await;
            if let Err(e) = dispatch_due_reminders(&app) {
                eprintln!("[scheduler] dispatch error: {e}");
            }
        }
    });
}

fn dispatch_due_reminders(app: &AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let state = app.state::<Database>();
    let due = state.with_conn(|conn| reminder_biz::claim_due_reminders(conn))?;
    for r in due {
        let body = r.summary();
        let _ = app
            .notification()
            .builder()
            .title("Weavine")
            .body(&body)
            .show();
    }
    Ok(())
}
