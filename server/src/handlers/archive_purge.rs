//! Retention sweep for archived and tombstoned rows.
//!
//! Archiving is not deleting. An archived todo / project / event / note /
//! contact stays in the database forever, and because every mutation lands in
//! `sync_change_log` it also keeps being re-delivered to every device. A user
//! who archives things regularly therefore accumulates history without bound —
//! both in the tables and in the log.
//!
//! This sweep closes that loop: rows whose retention window has elapsed are
//! **hard-deleted**, and because the delete runs through the normal
//! `sync_log_change()` trigger, `op = 'DELETE'` propagates to every device.
//! That is the important property — deleting only on the server would leave
//! each client holding a row the server no longer has, and the next push from
//! a client would resurrect it.
//!
//! Two clocks feed the window, both measured against the same cutoff:
//!
//!   * `archived_at < cutoff` — the archive that motivated the sweep.
//!   * `deleted_at  < cutoff` — the tombstone itself. Clients only ever soft-
//!     delete (see `apply_change` in src-tauri/src/sync/mod.rs), so a delete
//!     that has finished propagating is dead weight from then on: it is
//!     invisible, it can never be edited again, and it would otherwise sit in
//!     the table forever. Sweeping it also collects the residue of deletes
//!     that a client pushed back after the row was purged.
//!
//! Retention is per user, defaulting to `default_days`:
//!   * no `archive_retention_days` setting → `default_days` (see
//!     `ARCHIVE_RETENTION_DAYS` in main.rs)
//!   * setting `0` or negative → sweep disabled for that user
//!   * setting unparseable → `default_days` (never error out the whole sweep
//!     because one user's setting is junk)
//!
//! Deleting a parent cascades into its foreign-key children (project →
//! project_contact, event → reminder, contact → contact_tag / project_contact /
//! reminder). Those cascaded writes fire the same trigger, so they propagate
//! too. References that are *not* foreign keys — `note_entity` and `media` —
//! are cleaned separately by `purge_orphans`.

use chrono::{Duration, Utc};
use sqlx::PgPool;

/// Tables with an `archived_at` column that participate in retention.
///
/// `contact` is included (2026-09-26): a contact archived for the whole
/// retention window is out of the user's working set, and leaving the row
/// behind keeps its tag links, project memberships and reminders alive
/// forever. The contract is identical to every other table here — nothing is
/// removed until it has been archived for the full window, and the delete
/// propagates to every device.
///
/// ⚠️ Currently inert for `contact`: nothing writes `contact.archived_at`
/// (no server handler, no web SPA route, no desktop command), so the predicate
/// can never match. Kept because the column and the feature's other half —
/// `ARCHIVED_AT_TABLES` / the snapshot filter in `handlers::sync` — are already
/// in place, and removing it would have to be undone the moment an archive
/// entry point appears. Tracked in the spec's §18.3.
///
/// `pub(crate)` so `handlers::sync`'s guard test can assert the two archive
/// lists agree (see `archived_filter_tables_are_a_subset_of_purgeable_tables`).
pub(crate) const PURGEABLE_TABLES: &[&str] = &["action", "project", "event", "note", "contact"];

/// Polymorphic references — `(table, type column, id column)`.
///
/// These name their target with a string pair instead of a foreign key
/// (`note_entity.entity_type` / `media.owner_type`), so PostgreSQL cannot
/// cascade when the target row goes away. The type values are the table names
/// themselves: `note_entity.entity_type` is constrained to
/// `('contact','project','action','event')` and `media.owner_type` uses
/// `'contact'` for avatars — so `PURGEABLE_TABLES` drives both sides, and a
/// value that is not one of those names (`media.owner_type = 'user'`) is left
/// alone.
const POLYMORPHIC_REFS: &[(&str, &str, &str)] = &[
    ("note_entity", "entity_type", "entity_id"),
    ("media", "owner_type", "owner_id"),
];

/// Per-user override, in days, stored in the synced `setting` table so it can
/// be edited from any client.
pub const RETENTION_SETTING_KEY: &str = "archive_retention_days";

/// Hard floor for the per-user override, in days.
///
/// This setting reaches a **silent hard delete with no undo**, and its value is
/// free-form text in the synced `setting` table — writeable from any client,
/// including by hand. A typo that turns `30` into `3` would destroy a month of
/// archive history on the next sweep. Losing the ability to express "one day" is
/// a trivial price for that; `0` / negative still works as the deliberate
/// "never purge" escape hatch, which is the safe end of the range.
const MIN_RETENTION_DAYS: i64 = 7;

/// `archived_at` is written by the clients and by `business::archive_sweep` as
/// `%Y-%m-%dT%H:%M:%S%.3fZ`. Comparisons are lexicographic string compares, so
/// the cutoff has to be produced in exactly the same shape or the sweep would
/// either never fire or fire on everything.
fn format_cutoff(days: i64) -> String {
    (Utc::now() - Duration::days(days))
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

/// Resolve a raw `archive_retention_days` value into an effective window.
///
/// Pure so the three policies can be tested without a database:
///
/// | input | result | why |
/// | --- | --- | --- |
/// | absent | `default_days` | no override |
/// | unparseable (`""`, `"abc"`, `"30 天"`) | `default_days` | one user's junk setting must not skip the whole sweep, and must not silently mean "purge now" either |
/// | `<= 0` | as-is | the escape hatch: 0 or negative = keep archived rows forever |
/// | `1 .. MIN_RETENTION_DAYS` | `MIN_RETENTION_DAYS` | destructive path, floor enforced — see `MIN_RETENTION_DAYS` |
/// | `>= MIN_RETENTION_DAYS` | as-is | |
fn effective_retention(raw: Option<&str>, default_days: i64) -> i64 {
    let Some(raw) = raw else { return default_days };
    match raw.trim().parse::<i64>() {
        Ok(days) if days <= 0 => days,
        Ok(days) if days < MIN_RETENTION_DAYS => MIN_RETENTION_DAYS,
        Ok(days) => days,
        Err(_) => default_days,
    }
}

/// Effective retention for one user, in days. `<= 0` means "never purge".
async fn retention_days(pool: &PgPool, user_id: &str, default_days: i64) -> i64 {
    let row: Result<Option<(String,)>, _> = sqlx::query_as(
        "SELECT value FROM setting \
         WHERE user_id = $1 AND key = $2 AND deleted_at IS NULL \
         LIMIT 1",
    )
    .bind(user_id)
    .bind(RETENTION_SETTING_KEY)
    .fetch_optional(pool)
    .await;

    let raw = match row {
        Ok(Some((value,))) => Some(value),
        _ => None,
    };
    let days = effective_retention(raw.as_deref(), default_days);
    if days != default_days {
        // Worth a line: the sweep is destructive and the value comes from a
        // free-form synced setting, so "why did 40 rows disappear" needs an
        // answer in the log.
        println!(
            "[archive-purge] user={user_id} retention override: {} day(s) (default {default_days})",
            if days <= 0 { "never purge".to_string() } else { days.to_string() }
        );
    }
    days
}

/// Users that have at least one expired-or-tombstoned row in any purgeable
/// table.
async fn users_with_candidates(pool: &PgPool) -> Result<Vec<String>, sqlx::Error> {
    let predicate = PURGEABLE_TABLES
        .iter()
        .map(|t| {
            format!(
                "EXISTS (SELECT 1 FROM {t} x WHERE x.user_id = u.id \
                   AND (x.archived_at IS NOT NULL OR x.deleted_at IS NOT NULL))"
            )
        })
        .collect::<Vec<_>>()
        .join(" OR ");
    let sql = format!("SELECT u.id FROM user_account u WHERE {predicate}");
    let rows: Vec<(String,)> = sqlx::query_as(&sql).fetch_all(pool).await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// Hard-delete one user's expired rows from a single table.
///
/// `deleted_at < cutoff` is deliberate rather than `deleted_at IS NULL`: a
/// tombstone that has finished propagating is invisible and uneditable, so
/// keeping it only grows the table. `archived_at` is compared first so the
/// common case stays on the archive index.
async fn purge_table(
    pool: &PgPool,
    user_id: &str,
    table: &str,
    cutoff: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(&format!(
        "DELETE FROM {table} \
         WHERE user_id = $1 \
           AND ( \
                 (archived_at IS NOT NULL AND archived_at < $2) \
              OR (deleted_at  IS NOT NULL AND deleted_at  < $2) \
           )"
    ))
    .bind(user_id)
    .bind(cutoff)
    .execute(pool)
    .await?;

    let n = result.rows_affected();
    if n > 0 {
        println!("[archive-purge] user={user_id} table={table} deleted={n}");
    }
    Ok(n)
}

/// Hard-delete rows that point at a purged row through a polymorphic
/// reference.
///
/// Without this a purged contact would leave backlinks pointing at somebody
/// who no longer exists, and avatar rows still holding the uploaded bytes —
/// the exact space this sweep exists to reclaim, since `media.blob` is where a
/// photo actually lives. Runs per user over the small set of reference tables;
/// both `note_entity` and `media` have a sync trigger, so these deletes reach
/// the clients as well.
async fn purge_orphans(pool: &PgPool, user_id: &str) -> Result<u64, sqlx::Error> {
    let mut deleted = 0;

    for (table, type_col, id_col) in POLYMORPHIC_REFS {
        for target in PURGEABLE_TABLES {
            let result = sqlx::query(&format!(
                "DELETE FROM {table} \
                 WHERE user_id = $1 \
                   AND {type_col} = $2 \
                   AND {id_col} NOT IN (SELECT id FROM {target} WHERE user_id = $1)"
            ))
            .bind(user_id)
            .bind(*target)
            .execute(pool)
            .await?;

            let n = result.rows_affected();
            if n > 0 {
                deleted += n;
                println!(
                    "[archive-purge] user={user_id} table={table} orphan_of={target} deleted={n}"
                );
            }
        }
    }

    Ok(deleted)
}

/// Hard-delete expired rows for every user. Returns the total number of rows
/// removed (including polymorphic orphans).
pub async fn purge_archived_rows(pool: &PgPool, default_days: i64) -> Result<u64, sqlx::Error> {
    let mut deleted: u64 = 0;

    for user_id in users_with_candidates(pool).await? {
        let days = retention_days(pool, &user_id, default_days).await;
        if days <= 0 {
            continue;
        }
        let cutoff = format_cutoff(days);

        for table in PURGEABLE_TABLES {
            deleted += purge_table(pool, &user_id, table, &cutoff).await?;
        }

        // Runs unconditionally: orphans can predate this sweep (a contact
        // removed by any other path leaves the same debris), so it is not
        // limited to rows deleted in this pass.
        deleted += purge_orphans(pool, &user_id).await?;
    }

    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The cutoff is compared against `archived_at` as a plain string, so a
    /// format drift here is invisible until somebody's archive silently never
    /// expires (or expires immediately). Pin the shape.
    #[test]
    fn cutoff_stamp_matches_the_archived_at_format() {
        let stamp = format_cutoff(30);
        assert_eq!(stamp.len(), 24, "unexpected stamp: {stamp}");
        assert!(stamp.ends_with('Z'), "{stamp}");
        assert_eq!(&stamp[10..11], "T", "{stamp}");
        assert_eq!(&stamp[4..5], "-", "{stamp}");
        // Lexicographic ordering only works if the shape is fixed-width.
        assert!(format_cutoff(30) > format_cutoff(90));
    }

    #[test]
    fn contacts_participate_in_retention() {
        assert!(
            PURGEABLE_TABLES.contains(&"contact"),
            "contacts are swept once archived for the full window"
        );
    }

    /// Three policies, one table. The floor is the interesting one: the sweep is
    /// a hard delete with no undo and the value is a free-form synced setting,
    /// so a typo must not be able to shorten the window into the single digits.
    #[test]
    fn retention_override_is_floor_and_fallback_safe() {
        const D: i64 = 30;
        assert_eq!(effective_retention(None, D), D, "no setting → default");
        assert_eq!(effective_retention(Some("45"), D), 45);
        assert_eq!(effective_retention(Some("  45  "), D), 45, "trimmed");
        // The escape hatch has to survive: 0 and negatives mean "never purge",
        // which is the *safe* end of the range — unlike 1, which is not.
        assert_eq!(effective_retention(Some("0"), D), 0);
        assert_eq!(effective_retention(Some("-1"), D), -1);
        // Floor: a typo'd 3 must not destroy 27 days of archive history early.
        assert_eq!(effective_retention(Some("3"), D), MIN_RETENTION_DAYS);
        assert_eq!(effective_retention(Some("6"), D), MIN_RETENTION_DAYS);
        assert_eq!(effective_retention(Some("7"), D), 7);
        // Junk falls back rather than erroring the sweep — and must not mean
        // "purge immediately" either.
        assert_eq!(effective_retention(Some(""), D), D);
        assert_eq!(effective_retention(Some("abc"), D), D);
        assert_eq!(effective_retention(Some("30 天"), D), D);
    }

    /// Every table the sweep deletes from must exist under exactly this name,
    /// and every reference table must expose the columns `purge_orphans`
    /// interpolates. A rename in a migration would otherwise turn the sweep
    /// into a runtime SQL error on every cycle.
    #[test]
    fn every_purge_target_has_the_columns_the_sweep_writes() {
        for table in PURGEABLE_TABLES {
            assert!(
                !table.is_empty() && table.chars().all(|c| c.is_ascii_lowercase() || c == '_'),
                "`{table}` must be a plain identifier — it is interpolated into SQL"
            );
        }
        for (table, type_col, id_col) in POLYMORPHIC_REFS {
            assert!(
                !table.is_empty() && table.chars().all(|c| c.is_ascii_lowercase() || c == '_'),
                "`{table}` must be a plain identifier — it is interpolated into SQL"
            );
            assert!(!type_col.is_empty() && !id_col.is_empty());
            assert_ne!(type_col, id_col);
        }
    }
}
