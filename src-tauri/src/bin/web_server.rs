use axum::{
    http::{header::CACHE_CONTROL, HeaderValue},
    routing::{get, post, put},
    Router,
};
use std::sync::{Arc, Mutex};
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;

#[path = "../handlers/mod.rs"]
mod handlers;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<rusqlite::Connection>>,
}

#[tokio::main]
async fn main() {
    let db_path = std::env::var("WEB_DB_PATH").unwrap_or_else(|_| "weavine-web.db".into());
    let conn = rusqlite::Connection::open(&db_path).expect("open db");
    let _ = conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    weavine_lib::migration::run(&conn).expect("run migrations");
    let state = AppState {
        db: Arc::new(Mutex::new(conn)),
    };

    let app = Router::new()
        // Diagnostic
        .route("/api/diagnostic/user", get(handlers::diagnostic::user))
        .route("/api/diagnostic/startup", get(handlers::diagnostic::startup))
        // Contacts
        .route(
            "/api/contacts",
            get(handlers::contact::list).post(handlers::contact::create),
        )
        .route(
            "/api/contacts/:id",
            get(handlers::contact::get)
                .put(handlers::contact::update)
                .delete(handlers::contact::delete),
        )
        // Events — static route /upcoming before /:id
        .route("/api/events/upcoming", get(handlers::event::upcoming))
        .route(
            "/api/events",
            get(handlers::event::list).post(handlers::event::create),
        )
        .route(
            "/api/events/:id",
            get(handlers::event::get)
                .put(handlers::event::update)
                .delete(handlers::event::delete),
        )
        // Actions
        .route(
            "/api/actions",
            get(handlers::action::list).post(handlers::action::create),
        )
        .route(
            "/api/actions/:id",
            get(handlers::action::get)
                .put(handlers::action::update)
                .delete(handlers::action::delete),
        )
        // Projects
        .route(
            "/api/projects",
            get(handlers::project::list).post(handlers::project::create),
        )
        .route(
            "/api/projects/:id",
            get(handlers::project::get)
                .put(handlers::project::update)
                .delete(handlers::project::delete),
        )
        .route("/api/projects/stages", get(handlers::project::stages))
        // Interactions
        .route(
            "/api/interactions",
            get(handlers::interaction::list).post(handlers::interaction::create),
        )
        .route(
            "/api/interactions/:id",
            get(handlers::interaction::get)
                .put(handlers::interaction::update)
                .delete(handlers::interaction::delete),
        )
        // Reminders
        .route(
            "/api/reminders",
            get(handlers::reminder::list).post(handlers::reminder::create),
        )
        .route(
            "/api/reminders/:id",
            put(handlers::reminder::update).delete(handlers::reminder::delete),
        )
        .route(
            "/api/reminders/:id/dismiss",
            post(handlers::reminder::dismiss),
        )
        // Tags
        .route(
            "/api/tags",
            get(handlers::tag::list).post(handlers::tag::create),
        )
        .route(
            "/api/tags/:id",
            put(handlers::tag::update).delete(handlers::tag::delete),
        )
        // Settings — static route /upsert before parameterized
        .route("/api/settings/upsert", post(handlers::setting::upsert))
        .route(
            "/api/settings",
            get(handlers::setting::list).delete(handlers::setting::delete),
        )
        // Search
        .route("/api/search", get(handlers::search::query))
        // SPA static fallback — serves index.html for any non-/api path so
        // browser hard-refreshes of client-side routes (e.g. /contacts) work.
        .fallback_service(
            ServeDir::new("../apps/web-spa/dist")
                .fallback(ServeFile::new("../apps/web-spa/dist/index.html")),
        )
        .layer(SetResponseHeaderLayer::overriding(
            CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        ))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .unwrap();
    println!("weavine-web listening on http://0.0.0.0:3000");
    axum::serve(listener, app).await.unwrap();
}
