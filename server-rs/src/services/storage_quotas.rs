use crate::cache::Cache;
use crate::error::AppResult;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct StorageBreakdown {
    pub resource_type: String,
    pub total_bytes: i64,
    pub count: i64,
}

pub async fn record_usage(
    db: &sqlx::PgPool,
    organisation_id: &str,
    tenant_id: &str,
    resource_type: &str,
    resource_id: &str,
    size_bytes: i64,
) -> AppResult<()> {
    sqlx::query(
        r#"INSERT INTO storage_usage (organisation_id, tenant_id, resource_type, resource_id, size_bytes)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (organisation_id, resource_type, resource_id)
        DO UPDATE SET size_bytes = EXCLUDED.size_bytes"#,
    )
    .bind(organisation_id)
    .bind(tenant_id)
    .bind(resource_type)
    .bind(resource_id)
    .bind(size_bytes)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn remove_usage(
    db: &sqlx::PgPool,
    organisation_id: &str,
    resource_type: &str,
    resource_id: &str,
) -> AppResult<()> {
    sqlx::query(
        "DELETE FROM storage_usage WHERE organisation_id = $1 AND resource_type = $2 AND resource_id = $3",
    )
    .bind(organisation_id)
    .bind(resource_type)
    .bind(resource_id)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn get_total_usage(
    db: &sqlx::PgPool,
    cache: &Cache,
    organisation_id: &str,
) -> AppResult<i64> {
    let cache_key = format!("storage:{}", organisation_id);
    if let Some(cached) = cache.get(&cache_key).await {
        if let Ok(val) = cached.parse::<i64>() {
            return Ok(val);
        }
    }

    let total: Option<i64> = sqlx::query_scalar(
        "SELECT SUM(size_bytes) FROM storage_usage WHERE organisation_id = $1",
    )
    .bind(organisation_id)
    .fetch_one(db)
    .await?;

    let total = total.unwrap_or(0);
    cache.set(&cache_key, &total.to_string(), 300).await;
    Ok(total)
}

pub async fn get_usage_breakdown(
    db: &sqlx::PgPool,
    organisation_id: &str,
) -> AppResult<Vec<StorageBreakdown>> {
    let rows: Vec<(String, i64, i64)> = sqlx::query_as(
        "SELECT resource_type, COALESCE(SUM(size_bytes), 0)::bigint, COUNT(*)::bigint FROM storage_usage WHERE organisation_id = $1 GROUP BY resource_type",
    )
    .bind(organisation_id)
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(rt, total, count)| StorageBreakdown {
            resource_type: rt,
            total_bytes: total,
            count,
        })
        .collect())
}

pub async fn check_quota(
    db: &sqlx::PgPool,
    cache: &Cache,
    organisation_id: &str,
    additional_bytes: i64,
    limit_mb: i64,
) -> AppResult<bool> {
    if limit_mb < 0 {
        return Ok(true); // Unlimited
    }
    let current = get_total_usage(db, cache, organisation_id).await?;
    let limit_bytes = limit_mb * 1024 * 1024;
    Ok(current + additional_bytes <= limit_bytes)
}
