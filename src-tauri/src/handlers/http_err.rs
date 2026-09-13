use axum::http::StatusCode;

/// Maps a rusqlite::Error (or any error string) to a sensible HTTP status
/// for the web_server handlers.
///
/// - `QueryReturnedNoRows` -> 404 (record not found)
/// - SQLite `constraint` failures (FK, NOT NULL, UNIQUE) -> 422 (bad request)
/// - everything else -> 500 (internal)
pub fn for_get(err: &rusqlite::Error) -> (StatusCode, String) {
    let msg = err.to_string();
    match err {
        rusqlite::Error::QueryReturnedNoRows => (StatusCode::NOT_FOUND, msg),
        rusqlite::Error::SqliteFailure(ffi, _)
            if ffi.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            (StatusCode::UNPROCESSABLE_ENTITY, msg)
        }
        _ => (StatusCode::INTERNAL_SERVER_ERROR, msg),
    }
}

pub fn for_create_or_update(err: &rusqlite::Error) -> (StatusCode, String) {
    let msg = err.to_string();
    match err {
        rusqlite::Error::SqliteFailure(ffi, _)
            if ffi.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            (StatusCode::UNPROCESSABLE_ENTITY, msg)
        }
        _ => (StatusCode::INTERNAL_SERVER_ERROR, msg),
    }
}
