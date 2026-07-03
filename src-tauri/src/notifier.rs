//! Cross-platform OS notification helper.
//!
//! Wraps `notify-rust` so the scheduler can fire system notifications
//! without depending on the Tauri plugin ecosystem (which had its own
//! configuration-deserialization trouble that caused runtime panics).
//!
//! `notify-rust` calls the platform's native API directly:
//! - Windows: WinToast (WinRT)
//! - macOS: NSUserNotification / UNUserNotificationCenter
//! - Linux: org.freedesktop.Notifications over D-Bus
//!
//! Errors are logged and swallowed so a missing notification daemon
//! (Linux without a notification server, headless CI) does not crash
//! the scheduler loop.

use std::time::Duration;

/// Fire a transient notification to the user.
///
/// Failures are logged to stderr, never propagated. A missing
/// notification daemon must not take the scheduler down with it.
pub fn fire(title: &str, body: &str) {
    let summary = format!("Weavine · {title}");
    let body = if body.is_empty() { " " } else { body };
    let result = notify_rust::Notification::new()
        .summary(&summary)
        .body(body)
        .appname("Weavine")
        .timeout(Duration::from_secs(8))
        .show();
    if let Err(e) = result {
        eprintln!("[notifier] failed to fire notification: {e}");
    }
}
