use axum::{
    http::{header::CACHE_CONTROL, HeaderValue},
    routing::{delete, get, post, put},
    Router,
};
use sqlx::PgPool;
use std::sync::Arc;
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
};

mod auth_keys;
mod business;
mod handlers;

#[tokio::main]
async fn main() {
    let migrate_only = std::env::var("MIGRATE_ONLY").is_ok() || std::env::args().any(|a| a == "--migrate-only");

    let db_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set (postgres://weavine:pass@127.0.0.1/weavine)");
    let pool = PgPool::connect(&db_url)
        .await
        .expect("failed to connect to Postgres");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("failed to run migrations");

    if migrate_only {
        println!("Migrations complete. Exiting (MIGRATE_ONLY mode).");
        return;
    }

    let pool = Arc::new(pool);

    // Initialize JWT keys from PEM files (RS256)
    handlers::JWT_KEYS
        .set(auth_keys::Keys::from_env().expect("Failed to load JWT keys from PEM files"))
        .expect("JWT_KEYS already initialized");

    let app = Router::new()
        .route("/api/health", get(|| async { "OK" }))
        // Auth
        .route("/api/auth/register", post(handlers::auth::register))
        .route("/api/auth/login", post(handlers::auth::login))
        .route("/api/auth/refresh", post(handlers::auth::refresh))
        .route("/api/auth/logout", post(handlers::auth::logout))
        .route("/api/auth/me", get(handlers::auth::me))
        // Diagnostic
        .route("/api/diagnostic/user", get(handlers::diagnostic::user))
        .route("/api/diagnostic/startup", get(handlers::diagnostic::startup))
        // Contacts
        .route("/api/contacts", get(handlers::contact::list).post(handlers::contact::create))
        .route("/api/contacts/:id", get(handlers::contact::get).put(handlers::contact::update).delete(handlers::contact::delete))
        // Events
        .route("/api/events/upcoming", get(handlers::event::upcoming))
        .route("/api/events", get(handlers::event::list).post(handlers::event::create))
        .route("/api/events/:id", get(handlers::event::get).put(handlers::event::update).delete(handlers::event::delete))
        // Actions
        .route("/api/actions", get(handlers::action::list).post(handlers::action::create))
        .route("/api/actions/:id", get(handlers::action::get).put(handlers::action::update).delete(handlers::action::delete))
        // Projects
        .route("/api/projects", get(handlers::project::list).post(handlers::project::create))
        .route("/api/projects/stages", get(handlers::project::stages))
        .route("/api/projects/:id", get(handlers::project::get).put(handlers::project::update).delete(handlers::project::delete))
        .route("/api/projects/:id/contacts", get(handlers::project_contact::list).post(handlers::project_contact::add))
        .route("/api/projects/:id/contacts/:contact_id", delete(handlers::project_contact::remove))
        // Interactions
        .route("/api/interactions", get(handlers::interaction::list).post(handlers::interaction::create))
        .route("/api/interactions/:id", get(handlers::interaction::get).put(handlers::interaction::update).delete(handlers::interaction::delete))
        // Reminders
        .route("/api/reminders", get(handlers::reminder::list).post(handlers::reminder::create))
        .route("/api/reminders/:id", put(handlers::reminder::update).delete(handlers::reminder::delete))
        .route("/api/reminders/:id/dismiss", post(handlers::reminder::dismiss))
        // Tags
        .route("/api/tags", get(handlers::tag::list).post(handlers::tag::create))
        .route("/api/tags/:id", put(handlers::tag::update).delete(handlers::tag::delete))
        // Archive
        .route("/api/archive/summary", get(handlers::archive::archive_summary))
        .route("/api/archive/counts", get(handlers::archive::archive_counts))
        .route("/api/archive/list", get(handlers::archive::archive_list))
        .route("/api/archive/unarchive-one", post(handlers::archive::unarchive_one))
        .route("/api/archive/bulk-unarchive", post(handlers::archive::bulk_unarchive))
        .route("/api/archive/sweep", post(handlers::archive::sweep))
        // Settings
        .route("/api/settings/upsert", post(handlers::setting::upsert))
        .route("/api/settings", get(handlers::setting::list).delete(handlers::setting::delete))
        // Search
        .route("/api/search", get(handlers::search::query))
        .route("/api/api_keys", get(handlers::api_key::list).post(handlers::api_key::create))
        .route("/api/api_keys/:id", delete(handlers::api_key::revoke))
        // Sync
        .route("/api/sync/manifest", post(handlers::sync::manifest))
        .route("/api/sync/push", post(handlers::sync::push))
        .route("/api/sync/pull", post(handlers::sync::pull))
        // SPA fallback
        .fallback_service({
            let spa_dir =
                std::env::var("WEAVINE_SPA_DIR").unwrap_or_else(|_| "../apps/web-spa/dist".into());
            ServeDir::new(&spa_dir)
                .fallback(ServeFile::new(format!("{}/index.html", spa_dir.trim_end_matches('/'))))
        })
        .layer(SetResponseHeaderLayer::overriding(
            CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        ))
        .layer(CorsLayer::permissive())
        .with_state(pool);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".into());
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    println!("weavine-server listening on http://{addr}");
    axum::serve(listener, app).await.unwrap();
}
