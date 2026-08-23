use axum::{
    http::{header::CACHE_CONTROL, HeaderValue, Request},
    middleware::{self, Next},
    response::Response,
    routing::{delete, get, patch, post, put},
    Extension, Router,
};
use handlers::storage::{serve_file, LocalFsStorage, Storage};
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
};

mod api_key_crypto;
mod auth_keys;
mod auto_log_server;
mod business;
mod email;
mod handlers;
mod keep_in_touch_server;
mod rate_limit;
mod reminder_dispatcher;

const CHANGE_LOG_TTL_DAYS: i64 = 90;
const CHANGE_LOG_PRUNE_INTERVAL_SECS: u64 = 3600;

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

    let storage_root = std::env::var("MEDIA_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::path::PathBuf::from(std::env::var("WEAVINE_DATA_DIR").unwrap_or_else(|_| "/var/lib/weavine".into()))
                .join("media")
        });
    tokio::fs::create_dir_all(&storage_root).await.expect("create media dir");
    let storage: Arc<dyn Storage> = Arc::new(LocalFsStorage::new(storage_root));

    spawn_change_log_pruner(pool.clone());
    keep_in_touch_server::spawn_keep_in_touch_scheduler(pool.clone());
    reminder_dispatcher::spawn_reminder_dispatcher(pool.clone());

    // Initialize JWT keys from PEM files (RS256)
    handlers::JWT_KEYS
        .set(auth_keys::Keys::from_env().expect("Failed to load JWT keys from PEM files"))
        .expect("JWT_KEYS already initialized");
    // Shared service key for the zero-friction OCR/STT endpoints (WV_SERVICE_KEY).
    handlers::auth::init_service_key();
    // Email sender (defaults to log; SMTP if `smtp` feature + env vars set).
    email::init_sender();
    // In-process rate limiter for password-reset endpoints.
    handlers::auth::init_password_reset_rate_limiter();
    handlers::auth::init_ocr_voice_rate_limiter();

    let api = Router::new()
        .route("/api/health", get(|| async { "OK" }))
        // Auth
        .route("/api/auth/register", post(handlers::auth::register))
        .route("/api/auth/login", post(handlers::auth::login))
        .route("/api/auth/refresh", post(handlers::auth::refresh))
        .route("/api/auth/logout", post(handlers::auth::logout))
        .route("/api/auth/me", get(handlers::auth::me))
        .route("/api/auth/forgot-password", post(handlers::auth::forgot_password))
        .route("/api/auth/reset-password", post(handlers::auth::reset_password))
        // Activation tracking (anonymous, no auth required)
        .route("/api/activation/ping", post(handlers::activation::ping))
        // Diagnostic
        .route("/api/diagnostic/user", get(handlers::diagnostic::user))
        .route("/api/diagnostic/startup", get(handlers::diagnostic::startup))
        // Contacts
        .route("/api/contacts", get(handlers::contact::list).post(handlers::contact::create))
        .route("/api/contacts/:id", get(handlers::contact::get).put(handlers::contact::update).delete(handlers::contact::delete))
        .route("/api/graph/:contact_id", get(handlers::graph::get))
        .route("/api/graph/:contact_id/relations", post(handlers::graph::add_relation))
        .route("/api/graph/:contact_id/relations/:other_id", delete(handlers::graph::remove_relation))
        // Events
        .route("/api/events/upcoming", get(handlers::event::upcoming))
        .route("/api/events", get(handlers::event::list).post(handlers::event::create))
        .route("/api/events/:id", get(handlers::event::get).put(handlers::event::update).delete(handlers::event::delete))
        .route("/api/events/:id/participants", get(handlers::event::list_participants).post(handlers::event::add_participant))
        .route("/api/events/:id/participants/:cid", patch(handlers::event::set_participant_role).delete(handlers::event::remove_participant))
        // Actions
        .route("/api/actions", get(handlers::action::list).post(handlers::action::create))
        .route("/api/actions/:id", get(handlers::action::get).put(handlers::action::update).delete(handlers::action::delete))
        // Projects
        .route("/api/projects", get(handlers::project::list).post(handlers::project::create))
        .route("/api/projects/stages", get(handlers::project::stages))
        .route("/api/projects/:id", get(handlers::project::get).put(handlers::project::update).delete(handlers::project::delete))
        .route("/api/projects/:id/contacts", get(handlers::project_contact::list).post(handlers::project_contact::add))
        .route("/api/projects/:id/contacts/:contact_id", delete(handlers::project_contact::remove))
        .route("/api/media", post(handlers::media::upload).get(handlers::media::list_by_owner))
        .route("/api/media/:id", get(handlers::media::get_by_id).delete(handlers::media::delete))
        .route("/api/media/:id/blob", get(handlers::media::get_blob))
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
        .route("/api/api_keys/:id/plaintext", get(handlers::api_key::reveal))
        // Sync
        .route("/api/sync/manifest", post(handlers::sync::manifest))
        .route("/api/sync/push", post(handlers::sync::push))
        .route("/api/sync/pull", post(handlers::sync::pull))
        // Quick capture (Ctrl+K parser)
        .route("/api/quick/parse", post(handlers::quick::parse))
        .layer(SetResponseHeaderLayer::if_not_present(
            CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        ));

    let files = Router::new().route("/files/*key", get(serve_file));

    let mut app = api.merge(files);

    #[cfg(feature = "ocr")]
    {
        app = app.merge(Router::new().route("/api/cards/extract", post(handlers::ocr::extract_card)));
    }

    #[cfg(feature = "stt")]
    {
        app = app.merge(Router::new().route("/api/voice/recognize", post(handlers::voice::recognize)));
    }

    let app = app
        // SPA fallback
        .fallback_service({
            let spa_dir =
                std::env::var("WEAVINE_SPA_DIR").unwrap_or_else(|_| "../apps/web-spa/dist".into());
            ServeDir::new(&spa_dir)
                .fallback(ServeFile::new(format!("{}/index.html", spa_dir.trim_end_matches('/'))))
        })
        .layer(axum::middleware::from_fn(log_requests))
        .layer(CorsLayer::permissive())
        .layer(Extension(storage))
        .with_state(pool);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".into());
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    println!("weavine-server listening on http://{addr}");
    axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>())
        .await
        .unwrap();
}

fn spawn_change_log_pruner(pool: Arc<PgPool>) {
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        run_prune(&pool).await;
        let mut ticker = tokio::time::interval(Duration::from_secs(CHANGE_LOG_PRUNE_INTERVAL_SECS));
        ticker.tick().await;
        loop {
            ticker.tick().await;
            run_prune(&pool).await;
        }
    });
}

async fn run_prune(pool: &PgPool) {
    match handlers::sync::prune_change_log(pool, CHANGE_LOG_TTL_DAYS).await {
        Ok(n) if n > 0 => println!("[sync-prune] deleted {n} change_log rows older than {CHANGE_LOG_TTL_DAYS} days"),
        Err(e) => eprintln!("[sync-prune] error: {e}"),
        Ok(_) => {}
    }
}

/// Log every incoming request (method + path) BEFORE auth runs, so we can
/// see requests that fail with 401 at the auth layer (which never reach the
/// handler-level logs in media.rs / storage.rs).
async fn log_requests(req: Request<axum::body::Body>, next: Next) -> Response {
    let method = req.method().clone();
    let uri = req.uri().clone();
    eprintln!("[req] {method} {uri}");
    next.run(req).await
}
