use std::time::Duration;
use tauri::AppHandle;
use tauri::Manager;
use tokio::time::interval;

use crate::business::reminder as reminder_biz;
use crate::db::Database;
use crate::notifier;

const POLL_INTERVAL_SECS: u64 = 30;

/// Spawn the reminder polling loop on the Tauri async runtime.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = interval(Duration::from_secs(POLL_INTERVAL_SECS));
        ticker.tick().await;
        loop {
            ticker.tick().await;
            if let Err(e) = dispatch_due(&app) {
                eprintln!("[scheduler] tick failed: {e}");
            }
        }
    });
}

fn dispatch_due(app: &AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let state = app.state::<Database>();
    let due = state.with_conn(|conn| reminder_biz::claim_due_reminders(conn))?;
    for r in due {
        notifier::fire("提醒", &r.summary());
    }
    Ok(())
}
