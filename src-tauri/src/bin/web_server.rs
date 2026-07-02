use axum::{
    routing::{get, post, put},
    Router,
};
use std::sync::{Arc, Mutex};
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

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
    let state = AppState {
        db: Arc::new(Mutex::new(conn)),
    };

    let app = Router::new()
        // Diagnostic
        .route("/diagnostic/user", get(handlers::diagnostic::user))
        .route("/diagnostic/startup", get(handlers::diagnostic::startup))
        // Contacts
        .route(
            "/contacts",
            get(handlers::contact::list).post(handlers::contact::create),
        )
        .route(
            "/contacts/:id",
            get(handlers::contact::get)
                .put(handlers::contact::update)
                .delete(handlers::contact::delete),
        )
        // Events — static route /upcoming before /:id
        .route("/events/upcoming", get(handlers::event::upcoming))
        .route(
            "/events",
            get(handlers::event::list).post(handlers::event::create),
        )
        .route(
            "/events/:id",
            get(handlers::event::get)
                .put(handlers::event::update)
                .delete(handlers::event::delete),
        )
        // Actions
        .route(
            "/actions",
            get(handlers::action::list).post(handlers::action::create),
        )
        .route(
            "/actions/:id",
            get(handlers::action::get)
                .put(handlers::action::update)
                .delete(handlers::action::delete),
        )
        // Interactions
        .route(
            "/interactions",
            get(handlers::interaction::list).post(handlers::interaction::create),
        )
        .route(
            "/interactions/:id",
            get(handlers::interaction::get)
                .put(handlers::interaction::update)
                .delete(handlers::interaction::delete),
        )
        // Reminders
        .route(
            "/reminders",
            get(handlers::reminder::list).post(handlers::reminder::create),
        )
        .route(
            "/reminders/:id",
            put(handlers::reminder::update).delete(handlers::reminder::delete),
        )
        .route("/reminders/:id/dismiss", post(handlers::reminder::dismiss))
        // Tags
        .route(
            "/tags",
            get(handlers::tag::list).post(handlers::tag::create),
        )
        .route(
            "/tags/:id",
            put(handlers::tag::update).delete(handlers::tag::delete),
        )
        // Settings — static route /upsert before parameterized
        .route("/settings/upsert", post(handlers::setting::upsert))
        .route(
            "/settings",
            get(handlers::setting::list).delete(handlers::setting::delete),
        )
        // Search
        .route("/search", get(handlers::search::query))
        // SPA static fallback
        .fallback_service(
            ServeDir::new("../apps/web-spa/dist").append_index_html_on_directories(true),
        )
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .unwrap();
    println!("weavine-web listening on http://0.0.0.0:3000");
    axum::serve(listener, app).await.unwrap();
}
