use uuid::Uuid;

use crate::cache::Cache;
use crate::error::AppResult;
use crate::models::subscription::{plan_entitlements, ALL_FEATURES};

pub async fn sync_from_stripe(
    db: &sqlx::PgPool,
    cache: &Cache,
    stripe_sub: &serde_json::Value,
    tenant_id: &str,
) -> AppResult<()> {
    let stripe_customer_id = stripe_sub["customer"].as_str().unwrap_or("");
    let stripe_subscription_id = stripe_sub["id"].as_str().unwrap_or("");
    let status = stripe_sub["status"].as_str().unwrap_or("unknown");
    let plan_tier = stripe_sub["metadata"]["planTier"]
        .as_str()
        .unwrap_or("free");

    // Find organisation by stripe_customer_id
    let org_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM organisations WHERE stripe_customer_id = $1 AND tenant_id = $2",
    )
    .bind(stripe_customer_id)
    .bind(tenant_id)
    .fetch_optional(db)
    .await?;

    let org_id = match org_id {
        Some(id) => id,
        None => {
            tracing::warn!(
                "No org found for stripe customer {} in tenant {}",
                stripe_customer_id,
                tenant_id
            );
            return Ok(());
        }
    };

    // Extract dates
    let trial_start = stripe_sub["trial_start"].as_i64();
    let trial_end = stripe_sub["trial_end"].as_i64();
    let current_period_start = stripe_sub["current_period_start"].as_i64();
    let current_period_end = stripe_sub["current_period_end"].as_i64();
    let cancel_at = stripe_sub["cancel_at"].as_i64();
    let canceled_at = stripe_sub["canceled_at"].as_i64();
    let ended_at = stripe_sub["ended_at"].as_i64();
    let stripe_price_id = stripe_sub["items"]["data"][0]["price"]["id"]
        .as_str()
        .unwrap_or("");

    // Upsert subscription
    sqlx::query(
        r#"INSERT INTO subscriptions (id, organisation_id, tenant_id, stripe_subscription_id, stripe_customer_id,
            stripe_price_id, status, plan_tier, trial_start, trial_end,
            current_period_start, current_period_end, cancel_at, canceled_at, ended_at, updated_at)
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7,
            to_timestamp($8::double precision), to_timestamp($9::double precision),
            to_timestamp($10::double precision), to_timestamp($11::double precision),
            to_timestamp($12::double precision), to_timestamp($13::double precision),
            to_timestamp($14::double precision), NOW())
        ON CONFLICT (stripe_subscription_id) DO UPDATE SET
            status = EXCLUDED.status, plan_tier = EXCLUDED.plan_tier,
            stripe_price_id = EXCLUDED.stripe_price_id,
            trial_start = EXCLUDED.trial_start, trial_end = EXCLUDED.trial_end,
            current_period_start = EXCLUDED.current_period_start,
            current_period_end = EXCLUDED.current_period_end,
            cancel_at = EXCLUDED.cancel_at, canceled_at = EXCLUDED.canceled_at,
            ended_at = EXCLUDED.ended_at, updated_at = NOW()"#,
    )
    .bind(&org_id)
    .bind(tenant_id)
    .bind(stripe_subscription_id)
    .bind(stripe_customer_id)
    .bind(stripe_price_id)
    .bind(status)
    .bind(plan_tier)
    .bind(trial_start.map(|t| t as f64))
    .bind(trial_end.map(|t| t as f64))
    .bind(current_period_start.map(|t| t as f64))
    .bind(current_period_end.map(|t| t as f64))
    .bind(cancel_at.map(|t| t as f64))
    .bind(canceled_at.map(|t| t as f64))
    .bind(ended_at.map(|t| t as f64))
    .execute(db)
    .await?;

    // Get subscription ID for entitlements
    let sub_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM subscriptions WHERE stripe_subscription_id = $1 AND tenant_id = $2",
    )
    .bind(stripe_subscription_id)
    .bind(tenant_id)
    .fetch_optional(db)
    .await?;

    let sub_id = sub_id.unwrap_or_default();

    match status {
        "active" | "trialing" => {
            provision_entitlements(db, &org_id, &sub_id, tenant_id, plan_tier).await?;
        }
        "canceled" | "unpaid" | "incomplete_expired" => {
            revoke_entitlements(db, &org_id, tenant_id).await?;
        }
        _ => {}
    }

    // Clear cache
    cache.del(&format!("entitlements:{}", org_id)).await;

    Ok(())
}

pub async fn provision_entitlements(
    db: &sqlx::PgPool,
    organisation_id: &str,
    subscription_id: &str,
    tenant_id: &str,
    plan_tier: &str,
) -> AppResult<()> {
    let plan = plan_entitlements(plan_tier);

    // Set feature flags
    for feature in ALL_FEATURES {
        let enabled = plan.features.contains(feature);
        sqlx::query(
            r#"INSERT INTO entitlements (organisation_id, subscription_id, tenant_id, feature_key, is_enabled)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (organisation_id, feature_key) DO UPDATE SET
                is_enabled = EXCLUDED.is_enabled, subscription_id = EXCLUDED.subscription_id"#,
        )
        .bind(organisation_id)
        .bind(subscription_id)
        .bind(tenant_id)
        .bind(feature)
        .bind(enabled)
        .execute(db)
        .await?;
    }

    // Set limits
    let limits: &[(&str, i64)] = &[
        ("max_members", plan.max_members),
        ("max_storage_mb", plan.max_storage_mb),
        ("max_games", plan.max_games),
    ];

    for (key, value) in limits {
        let limit_val = if *value < 0 { None } else { Some(*value) };
        sqlx::query(
            r#"INSERT INTO entitlements (organisation_id, subscription_id, tenant_id, feature_key, is_enabled, limit_value)
            VALUES ($1, $2, $3, $4, true, $5)
            ON CONFLICT (organisation_id, feature_key) DO UPDATE SET
                is_enabled = true, limit_value = EXCLUDED.limit_value, subscription_id = EXCLUDED.subscription_id"#,
        )
        .bind(organisation_id)
        .bind(subscription_id)
        .bind(tenant_id)
        .bind(key)
        .bind(limit_val)
        .execute(db)
        .await?;
    }

    Ok(())
}

pub async fn revoke_entitlements(
    db: &sqlx::PgPool,
    organisation_id: &str,
    tenant_id: &str,
) -> AppResult<()> {
    // Downgrade to free plan
    provision_entitlements(db, organisation_id, "", tenant_id, "free").await
}

pub async fn get_effective_plan(
    db: &sqlx::PgPool,
    organisation_id: &str,
) -> AppResult<String> {
    let tier: Option<String> = sqlx::query_scalar(
        "SELECT plan_tier FROM subscriptions WHERE organisation_id = $1 AND status IN ('active', 'trialing') ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(organisation_id)
    .fetch_optional(db)
    .await?;

    Ok(tier.unwrap_or_else(|| "free".to_string()))
}

pub async fn has_used_trial(
    db: &sqlx::PgPool,
    player_id: Uuid,
    tenant_id: &str,
) -> AppResult<bool> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM trial_history WHERE player_id = $1 AND tenant_id = $2",
    )
    .bind(player_id)
    .bind(tenant_id)
    .fetch_one(db)
    .await?;

    Ok(count > 0)
}

pub async fn record_trial_start(
    db: &sqlx::PgPool,
    player_id: Uuid,
    tenant_id: &str,
    organisation_id: &str,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO trial_history (player_id, tenant_id, organisation_id, converted) VALUES ($1, $2, $3, false) ON CONFLICT DO NOTHING",
    )
    .bind(player_id)
    .bind(tenant_id)
    .bind(organisation_id)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn mark_trial_converted(
    db: &sqlx::PgPool,
    player_id: Uuid,
    tenant_id: &str,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE trial_history SET converted = true, trial_ended_at = NOW() WHERE player_id = $1 AND tenant_id = $2 AND converted = false",
    )
    .bind(player_id)
    .bind(tenant_id)
    .execute(db)
    .await?;
    Ok(())
}
