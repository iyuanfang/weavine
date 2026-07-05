use chrono::{DateTime, Duration, Utc};
use rusqlite::Connection;

/// Auto-archive eligible items across all three entities.
///
/// Rules (defaults, can be tuned from settings later):
///   - Action: status='done' AND completed_at IS NOT NULL AND
///     datetime(completed_at) < now - 1 day
///   - Event:  datetime(COALESCE(end_at, start_at)) < now - 1 day
///   - Project: stage in (terminal stages of project's template) AND
///     datetime(updated_at) < now - 7 days.  Terminal stages are sourced
///     from `Template::is_terminal`.
///
/// Sweep is idempotent: items already archived (archived_at IS NOT NULL)
/// are not re-archived.  Returns total archived count.
pub fn sweep_archives(conn: &Connection, now: DateTime<Utc>) -> rusqlite::Result<usize> {
    let now_str = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let action_cutoff = (now - Duration::days(1))
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    let event_cutoff = (now - Duration::days(1))
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    let project_cutoff = (now - Duration::days(7))
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    let mut total = 0usize;

    let action_archived = conn.execute(
        "UPDATE Action \
         SET archived_at = ?1, updated_at = ?1 \
         WHERE archived_at IS NULL \
           AND status = 'done' \
           AND completed_at IS NOT NULL \
           AND datetime(completed_at) < datetime(?2)",
        rusqlite::params![&now_str, &action_cutoff],
    )?;
    total += action_archived;

    let event_archived = conn.execute(
        "UPDATE Event \
         SET archived_at = ?1, updated_at = ?1 \
         WHERE archived_at IS NULL \
           AND datetime(COALESCE(end_at, start_at)) < datetime(?2)",
        rusqlite::params![&now_str, &event_cutoff],
    )?;
    total += event_archived;

    let mut stmt = conn.prepare(
        "SELECT id, template, stage, updated_at FROM \"Project\" \
         WHERE archived_at IS NULL",
    )?;
    let candidates: Vec<(String, String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);

    let mut project_archived = 0usize;
    for (id, template, stage, updated_at) in candidates {
        let terminal = crate::project_template::Template::from_str_opt(&template)
            .map(|t| t.is_terminal(&stage))
            .unwrap_or(false);
        if !terminal {
            continue;
        }
        if updated_at.as_str() >= project_cutoff.as_str() {
            continue;
        }
        let changed = conn.execute(
            "UPDATE \"Project\" \
             SET archived_at = ?1, updated_at = ?1 \
             WHERE id = ?2 AND archived_at IS NULL",
            rusqlite::params![&now_str, &id],
        )?;
        project_archived += changed;
    }
    total += project_archived;

    Ok(total)
}
