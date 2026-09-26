pub mod action;
pub mod activation;
pub mod api_key;
pub mod archive;
pub mod archive_purge;
pub mod auth;
pub mod contact;
pub mod diagnostic;
pub mod event;
pub mod graph;
pub mod interaction;
pub mod media;
pub mod note;
#[cfg(feature = "ocr")]
pub mod ocr;
#[cfg(feature = "stt")]
pub mod voice;
pub mod project;
pub mod project_contact;
pub mod quick;
pub mod reminder;
pub mod search;
pub mod setting;
pub mod sync;
pub mod storage;
pub mod tag;

use std::sync::OnceLock;
use crate::auth_keys::Keys;

pub static JWT_KEYS: OnceLock<Keys> = OnceLock::new();

pub fn now_str() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

#[cfg(test)]
mod tests {
    /// Every handler source, read at compile time. `include_str!` rather than a
    /// runtime file read so the test cannot silently scan zero files when it is
    /// run from a different working directory.
    const HANDLER_SOURCES: &[(&str, &str)] = &[
        ("action", include_str!("action.rs")),
        ("activation", include_str!("activation.rs")),
        ("api_key", include_str!("api_key.rs")),
        ("archive", include_str!("archive.rs")),
        ("archive_purge", include_str!("archive_purge.rs")),
        ("auth", include_str!("auth.rs")),
        ("contact", include_str!("contact.rs")),
        ("diagnostic", include_str!("diagnostic.rs")),
        ("event", include_str!("event.rs")),
        ("graph", include_str!("graph.rs")),
        ("interaction", include_str!("interaction.rs")),
        ("media", include_str!("media.rs")),
        ("note", include_str!("note.rs")),
        ("ocr", include_str!("ocr.rs")),
        ("project", include_str!("project.rs")),
        ("project_contact", include_str!("project_contact.rs")),
        ("quick", include_str!("quick.rs")),
        ("reminder", include_str!("reminder.rs")),
        ("search", include_str!("search.rs")),
        ("setting", include_str!("setting.rs")),
        ("storage", include_str!("storage.rs")),
        ("sync", include_str!("sync.rs")),
        ("tag", include_str!("tag.rs")),
        ("voice", include_str!("voice.rs")),
    ];

    /// Writes that legitimately do not name `user_id`, keyed by
    /// `(file stem, fragment of the statement)`.
    ///
    /// Keep this list short and every reason specific — it is the *only* way an
    /// unscoped write can pass the guard below, so an entry added to make the
    /// suite green is precisely the bug the guard exists to catch.
    const SCOPE_EXEMPT: &[(&str, &str, &str)] = &[
        (
            "activation",
            "UPDATE install_activation",
            "keyed by `install_id`, which is itself the anonymous-device credential",
        ),
        (
            "auth",
            "UPDATE devices",
            "`id` comes from the access token being refreshed, never from the request",
        ),
        (
            "auth",
            "UPDATE refresh_token",
            "scoped by `token_hash` — the token is the credential",
        ),
        (
            "auth",
            "UPDATE user_account",
            "`id` comes from a consumed `password_reset_token`, not from the request",
        ),
        (
            "auth",
            "UPDATE password_reset_token",
            "`id` comes from the `token_hash` lookup that authorised the reset",
        ),
        (
            "sync",
            "DELETE FROM sync_change_log",
            "server-internal replication log, not user content",
        ),
    ];

    /// Byte-range scan for `"..."` literals. Handler SQL uses no raw strings
    /// (`r#"..."#`) and no escaped quotes other than `\<newline>`, so a plain
    /// double-quote scan is enough.
    fn string_literals(src: &str) -> Vec<&str> {
        let bytes = src.as_bytes();
        let mut out = Vec::new();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] != b'"' {
                i += 1;
                continue;
            }
            let start = i + 1;
            let mut j = start;
            while j < bytes.len() {
                match bytes[j] {
                    b'\\' => j += 2,
                    b'"' => break,
                    _ => j += 1,
                }
            }
            if j >= bytes.len() {
                break;
            }
            out.push(&src[start..j]);
            i = j + 1;
        }
        out
    }

    /// Every `UPDATE` / `DELETE FROM` in the handler layer must name `user_id`.
    ///
    /// This shape has now produced bugs three rounds running: a handler scopes
    /// its *primary* statement correctly and then writes through a secondary one
    /// that has no owner predicate — `UPDATE event SET contact_id` and
    /// `UPDATE reminder` reached from `event::update` / `event::delete`, and a
    /// `SELECT` behind `tag::update` that returned another user's row. It stays
    /// invisible because the primary statement matches zero rows instead of
    /// failing, so nothing looks wrong until a second user exists.
    ///
    /// Scope of the check, stated honestly: it reads SQL **as written**, so a
    /// statement built with `format!` is only checked on its literal parts (the
    /// interpolations are table/column names, never values), and it says nothing
    /// about reads — those follow the per-kind query templates instead.
    #[test]
    fn writes_to_owned_tables_name_user_id() {
        let mut scanned = 0usize;
        let mut offenders = Vec::new();

        for (file, src) in HANDLER_SOURCES {
            for raw in string_literals(src) {
                let sql = raw.trim();
                let verb = if sql.starts_with("UPDATE ") {
                    "UPDATE"
                } else if sql.starts_with("DELETE FROM ") {
                    "DELETE FROM"
                } else {
                    continue;
                };
                scanned += 1;
                if sql.contains("user_id") {
                    continue;
                }
                if SCOPE_EXEMPT
                    .iter()
                    .any(|(f, frag, _)| f == file && sql.contains(frag))
                {
                    continue;
                }
                offenders.push(format!(
                    "{file}.rs: {verb} {}",
                    sql.split_whitespace().collect::<Vec<_>>().join(" ")
                ));
            }
        }

        // Without this, a broken scanner would make the assertion below pass for
        // the wrong reason (it would scan nothing and find nothing).
        assert!(
            scanned >= 40,
            "the scanner only found {scanned} write statements in the handler \
             layer; the scanner is broken, not the code"
        );
        assert!(
            offenders.is_empty(),
            "these statements write without a `user_id` predicate, so they can \
             touch another user's row. Add `AND user_id = $n` (and bind the \
             authenticated id), or add a justified entry to SCOPE_EXEMPT:\n  {}",
            offenders.join("\n  ")
        );
    }

    /// Reads that legitimately look a row up by id without `user_id`, keyed by
    /// `(file stem, fragment)`. Both are addressed by a bearer secret: the id
    /// comes from a consumed token, never from the request.
    ///
    /// - `SELECT email FROM user_account` — `id` comes from the verified JWT subject.
    /// - `SELECT used_at FROM password_reset_token` — `id` comes from the
    ///   `token_hash` lookup that authorised the reset.
    const READ_SCOPE_EXEMPT: &[(&str, &str)] = &[
        ("auth", "SELECT email FROM user_account"),
        ("auth", "SELECT used_at FROM password_reset_token"),
    ];

    /// The read half of the same rule: a `SELECT` that resolves a row by primary
    /// key must name the owner.
    ///
    /// `tag::update` was the live instance — its `UPDATE` was scoped, so a
    /// foreign id updated zero rows, but the trailing `SELECT ... WHERE id = $1`
    /// was not, and the handler answered `200 OK` with the other user's tag. A
    /// no-op write with a leaking response is the same class as a leaking write:
    /// nothing reports an error, so only an explicit check catches it.
    ///
    /// Deliberately narrow: it only inspects statements whose `WHERE` filters a
    /// bare primary key (`id = $n` / `e.id = $n`). Reads that filter by some
    /// other column are governed by their own predicate and are not second-guessed
    /// here.
    #[test]
    fn reads_by_primary_key_name_user_id() {
        let mut scanned = 0usize;
        let mut offenders = Vec::new();

        for (file, src) in HANDLER_SOURCES {
            for raw in string_literals(src) {
                let sql = raw.trim();
                if !sql.starts_with("SELECT ") {
                    continue;
                }
                if !sql.contains("WHERE id =") && !sql.contains("WHERE e.id =") {
                    continue;
                }
                scanned += 1;
                if sql.contains("user_id") {
                    continue;
                }
                if READ_SCOPE_EXEMPT
                    .iter()
                    .any(|(f, frag)| f == file && sql.contains(frag))
                {
                    continue;
                }
                offenders.push(format!(
                    "{file}.rs: {}",
                    sql.split_whitespace().collect::<Vec<_>>().join(" ")
                ));
            }
        }

        assert!(
            scanned >= 5,
            "the scanner only found {scanned} by-primary-key reads; the scanner \
             is broken, not the code"
        );
        assert!(
            offenders.is_empty(),
            "these reads resolve a row by primary key without a `user_id` \
             predicate, so they can return another user's row even when the \
             statement that guarded them matched nothing. Add `AND user_id = $n` \
             (and bind the authenticated id), or add a justified entry to \
             READ_SCOPE_EXEMPT:\n  {}",
            offenders.join("\n  ")
        );
    }

    /// The request log clamps attacker-controlled text. A URI at or under the
    /// limit is returned untouched; a longer one is cut back to a char boundary
    /// so the log line stays valid UTF-8.
    #[test]
    fn log_truncation_clamps_and_stays_on_char_boundaries() {
        assert_eq!(
            crate::truncate_for_log("/api/contacts", 256),
            "/api/contacts"
        );
        // Exactly at the limit: unchanged. One byte over: cut back.
        assert_eq!(crate::truncate_for_log("abcdef", 6), "abcdef");
        assert_eq!(crate::truncate_for_log("abcdefg", 6), "abcdef");
        // 3-byte chars: 7 is not a boundary inside "中中中", 6 is.
        assert_eq!(crate::truncate_for_log("中中中", 7), "中中");
        assert_eq!(crate::truncate_for_log("中中中", 6), "中中");

        let long = format!("/api/search?q={}", "中".repeat(500));
        let cut = crate::truncate_for_log(&long, 256);
        assert!(long.starts_with(cut));
        assert!(cut.len() <= 256, "a 1500-byte query must not become a 1500-byte log line");
        assert!(std::str::from_utf8(cut.as_bytes()).is_ok());
    }
}
