/// UTC now in the exact shape the sync layer compares as LWW timestamps:
/// RFC3339, `T` separator, millisecond precision, `Z` suffix.
///
/// Deliberately *not* SQLite's `CURRENT_TIMESTAMP`, which the `created_at`
/// columns use. That produces `2026-09-26 19:30:00` — no `T`, no zone — and the
/// server's `normalize_lww_timestamp` cannot parse it, so the comparison would
/// fall back to raw bytes where `' '` (0x20) sorts below `'T'` (0x54) and the
/// client wins regardless of chronology. Every `updated_at` write must use this
/// helper so both ends agree on one format.
pub(crate) fn lww_now() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

/// Backfill value for rows that predate their `updated_at` column.
///
/// Deliberately identical on **both** sides — the server migration seeds the
/// column NULL (never the sentinel) and this value is only ever written by the
/// client. The asymmetry is the point: the server's LWW branch treats a NULL
/// existing value as "no information, accept the client's", so a device
/// upgrading for the first time can push its whole table and be accepted. Two
/// devices that both hold the sentinel then compare *equal*, which the server
/// treats as "nothing to do" — no upsert, no conflict — instead of one device
/// silently overwriting the other's data on upgrade.
///
/// A sentinel of "now" would be wrong: every pre-existing row would look
/// freshly edited by whoever upgraded first.
pub(crate) const LWW_SENTINEL: &str = "1970-01-01T00:00:00.000Z";

pub mod action;
pub mod archive_sweep;
pub mod auto_log;
pub mod keep_in_touch;
pub mod contact;
pub mod diagnostic;
pub mod event;
pub mod event_participant;
pub mod graph;
pub mod interaction;
pub mod note;
pub mod project;
pub mod project_contact;
pub mod reminder;
pub mod search;
pub mod setting;
pub mod tag;
