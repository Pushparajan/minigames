use serde_json::json;
use uuid::Uuid;

use crate::cache::Cache;
use crate::error::{AppError, AppResult};

pub async fn check_entitlement(
    db: &sqlx::PgPool,
    cache: &Cache,
    organisation_id: &str,
    tenant_id: &str,
    feature_key: &str,
) -> AppResult<bool> {
    let cache_key = format!("entitlements:{}", organisation_id);
    if let Some(cached) = cache.get_json::<serde_json::Value>(&cache_key).await {
        if let Some(enabled) = cached.get(feature_key).and_then(|v| v.as_bool()) {
            return Ok(enabled);
        }
    }

    let row = sqlx::query_scalar::<_, bool>(
        "SELECT is_enabled FROM entitlements WHERE organisation_id = $1 AND tenant_id = $2 AND feature_key = $3",
    )
    .bind(organisation_id)
    .bind(tenant_id)
    .bind(feature_key)
    .fetch_optional(db)
    .await?;

    Ok(row.unwrap_or(false))
}

pub async fn get_limit(
    db: &sqlx::PgPool,
    cache: &Cache,
    organisation_id: &str,
    tenant_id: &str,
    feature_key: &str,
) -> AppResult<Option<i64>> {
    let cache_key = format!("entitlements:{}", organisation_id);
    if let Some(cached) = cache.get_json::<serde_json::Value>(&cache_key).await {
        if let Some(limit) = cached.get(feature_key).and_then(|v| v.as_i64()) {
            return Ok(Some(limit));
        }
    }

    let row = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT limit_value FROM entitlements WHERE organisation_id = $1 AND tenant_id = $2 AND feature_key = $3",
    )
    .bind(organisation_id)
    .bind(tenant_id)
    .bind(feature_key)
    .fetch_optional(db)
    .await?;

    Ok(row.flatten())
}

pub async fn get_current_usage(
    db: &sqlx::PgPool,
    organisation_id: &str,
    tenant_id: &str,
    feature_key: &str,
) -> AppResult<i64> {
    let count = match feature_key {
        "max_members" => {
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*)::bigint FROM organisation_members WHERE organisation_id = $1 AND tenant_id = $2",
            )
            .bind(organisation_id)
            .bind(tenant_id)
            .fetch_one(db)
            .await?
        }
        "max_games" => {
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*)::bigint FROM custom_games WHERE tenant_id = $1 AND is_active = true",
            )
            .bind(tenant_id)
            .fetch_one(db)
            .await?
        }
        "max_storage_mb" => {
            let bytes = sqlx::query_scalar::<_, Option<i64>>(
                "SELECT SUM(size_bytes) FROM storage_usage WHERE organisation_id = $1 AND tenant_id = $2",
            )
            .bind(organisation_id)
            .bind(tenant_id)
            .fetch_one(db)
            .await?;
            bytes.unwrap_or(0) / (1024 * 1024)
        }
        _ => 0,
    };
    Ok(count)
}

pub async fn get_all_entitlements(
    db: &sqlx::PgPool,
    cache: &Cache,
    organisation_id: &str,
    tenant_id: &str,
) -> AppResult<serde_json::Value> {
    let cache_key = format!("entitlements:{}", organisation_id);
    if let Some(cached) = cache.get_json::<serde_json::Value>(&cache_key).await {
        return Ok(cached);
    }

    let rows: Vec<(String, bool, Option<i64>)> = sqlx::query_as(
        "SELECT feature_key, is_enabled, limit_value FROM entitlements WHERE organisation_id = $1 AND tenant_id = $2",
    )
    .bind(organisation_id)
    .bind(tenant_id)
    .fetch_all(db)
    .await?;

    let mut map = serde_json::Map::new();
    for (key, enabled, limit) in rows {
        if let Some(l) = limit {
            map.insert(key, json!(l));
        } else {
            map.insert(key, json!(enabled));
        }
    }

    let result = serde_json::Value::Object(map);
    cache.set_json(&cache_key, &result, 120).await;
    Ok(result)
}

pub async fn require_entitlement_check(
    db: &sqlx::PgPool,
    cache: &Cache,
    player_id: Uuid,
    tenant_id: &str,
    feature_key: &str,
) -> AppResult<String> {
    // Find the player's organisation
    let org_id = sqlx::query_scalar::<_, String>(
        "SELECT om.organisation_id FROM organisation_members om WHERE om.player_id = $1 AND om.tenant_id = $2 LIMIT 1",
    )
    .bind(player_id)
    .bind(tenant_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::Forbidden("No organisation found".into()))?;

    let enabled = check_entitlement(db, cache, &org_id, tenant_id, feature_key).await?;
    if !enabled {
        return Err(AppError::Forbidden(format!(
            "Feature '{}' not enabled for your plan",
            feature_key
        )));
    }

    Ok(org_id)
}
