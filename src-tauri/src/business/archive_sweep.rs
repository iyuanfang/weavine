use chrono::{DateTime, Duration, Utc};
use rusqlite::Connection;

/// Auto-archive eligible items across all three entities.
///
/// Rules (defaults, can be tuned from settings later):
///   - Action: status='done' AND completedAt IS NOT NULL AND
///     datetime(completedAt) < now - 1 day
///   - Event:  datetime(COALESCE(endAt, startAt)) < now  (zero-day, fires immediately)
///   - Project: stage in (terminal stages of project's template) AND
///     datetime(updatedAt) < now - 7 days.  Terminal stages are sourced
///     from `Template::is_terminal`.
///
/// Sweep is idempotent: items already archived (archivedAt IS NOT NULL)
/// are not re-archived.  Returns total archived count.
pub fn sweep_archives(conn: &Connection, now: DateTime<Utc>) -> rusqlite::Result<usize> {
    let now_str = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let action_cutoff = (now - Duration::days(1))
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    let project_cutoff = (now - Duration::days(7))
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    let mut total = 0usize;

    let action_archived = conn.execute(
        "UPDATE Action \
         SET archivedAt = ?1, updatedAt = ?1 \
         WHERE archivedAt IS NULL \
           AND status = 'done' \
           AND completedAt IS NOT NULL \
           AND datetime(completedAt) < datetime(?2)",
        rusqlite::params![&now_str, &action_cutoff],
    )?;
    total += action_archived;

    let event_archived = conn.execute(
        "UPDATE Event \
         SET archivedAt = ?1, updatedAt = ?1 \
         WHERE archivedAt IS NULL \
           AND datetime(COALESCE(endAt, startAt)) < datetime(?2)",
        rusqlite::params![&now_str, &now_str],
    )?;
    total += event_archived;

    let mut stmt = conn.prepare(
        "SELECT id, template, stage, updatedAt FROM \"Project\" \
         WHERE archivedAt IS NULL",
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
             SET archivedAt = ?1, updatedAt = ?1 \
             WHERE id = ?2 AND archivedAt IS NULL",
            rusqlite::params![&now_str, &id],
        )?;
        project_archived += changed;
    }
    total += project_archived;

    Ok(total)
}
