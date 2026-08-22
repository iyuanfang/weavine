use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;

const TERMINAL_STAGES: &[&str] = &["done", "won", "lost", "closed", "已完成", "中标", "丢单", "已收尾"];

pub async fn sweep_user(pool: &PgPool, user_id: &str, now: DateTime<Utc>) -> Result<usize, sqlx::Error> {
    let now_str = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let d1 = (now - Duration::days(1)).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let d7 = (now - Duration::days(7)).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

    let action = sqlx::query(
        "UPDATE action SET archived_at = $1, updated_at = $1 \
         WHERE user_id = $2 AND archived_at IS NULL \
           AND status = 'done' AND completed_at IS NOT NULL \
           AND completed_at < $3",
    )
    .bind(&now_str).bind(user_id).bind(&d1)
    .execute(pool).await?
    .rows_affected();

    let event = sqlx::query(
        "UPDATE event SET archived_at = $1, updated_at = $1 \
         WHERE user_id = $2 AND archived_at IS NULL \
           AND COALESCE(end_at, start_at) < $3",
    )
    .bind(&now_str).bind(user_id).bind(&d1)
    .execute(pool).await?
    .rows_affected();

    let placeholders = (0..TERMINAL_STAGES.len())
        .map(|i| format!("${}", 4 + i))
        .collect::<Vec<_>>()
        .join(", ");
    let project_sql = format!(
        "UPDATE project SET archived_at = $1, updated_at = $1 \
         WHERE user_id = $2 AND archived_at IS NULL \
           AND updated_at < $3 AND stage IN ({placeholders})"
    );
    let mut query = sqlx::query(&project_sql).bind(&now_str).bind(user_id).bind(&d7);
    for s in TERMINAL_STAGES {
        query = query.bind(*s);
    }
    let project = query.execute(pool).await?.rows_affected();

    sqlx::query(
        "UPDATE user_account SET last_archive_sweep_at = $1 WHERE id = $2",
    )
    .bind(&now_str).bind(user_id)
    .execute(pool).await?;

    Ok((action + event + project) as usize)
}

pub async fn sweep_user_if_stale(
    pool: &PgPool,
    user_id: &str,
    now: DateTime<Utc>,
) -> Result<usize, sqlx::Error> {
    let last: Option<String> = sqlx::query_scalar(
        "SELECT last_archive_sweep_at FROM user_account WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let stale = match last.as_deref() {
        None => true,
        Some(s) => {
            let parsed = DateTime::parse_from_rfc3339(s).ok();
            parsed.map(|t| (now - t.with_timezone(&Utc)) > Duration::hours(6)).unwrap_or(true)
        }
    };

    if stale { sweep_user(pool, user_id, now).await } else { Ok(0) }
}
