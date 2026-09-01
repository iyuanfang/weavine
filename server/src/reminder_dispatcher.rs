use std::sync::Arc;
use sqlx::PgPool;

use crate::handlers::now_str;

// Server-side fallback; client's ReminderPoller normally owns dispatch.
async fn dispatch_due_reminders(pool: &PgPool) -> Result<usize, sqlx::Error> {
    let now_rfc3339 = now_str();
    let rows: Vec<(String,)> = sqlx::query_as(
        "UPDATE reminder SET dispatched = true \
         WHERE dispatched = false AND dismissed = false \
           AND trigger_at <= $1 \
           AND deleted_at IS NULL \
         RETURNING id",
    )
    .bind(&now_rfc3339)
    .fetch_all(pool)
    .await?;
    Ok(rows.len())
}

const REMINDER_DISPATCH_INTERVAL_SECS: u64 = 60;

pub fn spawn_reminder_dispatcher(pool: Arc<PgPool>) {
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(
            REMINDER_DISPATCH_INTERVAL_SECS,
        ));
        ticker.tick().await;
        loop {
            ticker.tick().await;
            match dispatch_due_reminders(&pool).await {
                Ok(n) if n > 0 => {
                    println!("[reminder-dispatch] scanned due, marked {n} dispatched");
                }
                Err(e) => eprintln!("[reminder-dispatch] error: {e}"),
                Ok(_) => {}
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::now_str;
    use sqlx::PgPool;

    #[test]
    fn test_interval_const() {
        assert_eq!(REMINDER_DISPATCH_INTERVAL_SECS, 60);
    }

    #[sqlx::test]
    async fn test_dispatch_marks_due_reminder(pool: PgPool) {
        let user_id = uuid::Uuid::new_v4().to_string();
        let past = chrono::Utc::now() - chrono::Duration::hours(2);
        let now = now_str();

        sqlx::query("INSERT INTO user_account (id, email, password_hash, created_at, updated_at) VALUES ($1,$2,$3,$4,$5)")
            .bind(&user_id)
            .bind(&format!("{}@t.com", &user_id[..8]))
            .bind("fake_hash")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query(
            "INSERT INTO reminder (id, user_id, trigger_at, kind, created_at) \
             VALUES (gen_random_uuid()::text, $1, $2, 'time', $3)",
        )
        .bind(&user_id)
        .bind(past.to_rfc3339())
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        let count = dispatch_due_reminders(&pool).await.unwrap();
        assert_eq!(count, 1);

        let dispatched: bool = sqlx::query_scalar("SELECT dispatched FROM reminder")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(dispatched);
    }

    #[sqlx::test]
    async fn test_dispatch_skips_future_and_dismissed(pool: PgPool) {
        let user_id = uuid::Uuid::new_v4().to_string();
        let now = now_str();
        let future = chrono::Utc::now() + chrono::Duration::hours(2);

        sqlx::query("INSERT INTO user_account (id, email, password_hash, created_at, updated_at) VALUES ($1,$2,$3,$4,$5)")
            .bind(&user_id)
            .bind(&format!("{}@t.com", &user_id[..8]))
            .bind("fake_hash")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query(
            "INSERT INTO reminder (id, user_id, trigger_at, kind, dismissed, created_at) \
             VALUES (gen_random_uuid()::text, $1, $2, 'time', true, $3)",
        )
        .bind(&user_id)
        .bind(future.to_rfc3339())
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        let count = dispatch_due_reminders(&pool).await.unwrap();
        assert_eq!(count, 0);
    }
}