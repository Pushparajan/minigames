use axum::{extract::State, Json};
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthPlayer;
use crate::middleware::tenant::TenantId;
use crate::models::subscription::*;
use crate::services::{subscription_sync, usage_meters, storage_quotas};
use crate::AppState;

pub async fn subscribe(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Json(body): Json<SubscribeRequest>,
) -> AppResult<Json<Value>> {
    let tenant_id = &tenant.0 .0;
    let stripe = state.stripe.as_ref()
        .ok_or_else(|| AppError::Internal("Stripe not configured".into()))?;

    // Get org
    let org: Option<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT id, name, stripe_customer_id FROM organisations WHERE id = $1 AND tenant_id = $2",
    )
    .bind(&body.organisation_id)
    .bind(tenant_id)
    .fetch_optional(&state.db)
    .await?;

    let (org_id, org_name, existing_customer_id) =
        org.ok_or_else(|| AppError::NotFound("Organisation not found".into()))?;

    // Create or get Stripe customer
    let customer_id = match existing_customer_id {
        Some(cid) if !cid.is_empty() => cid,
        _ => {
            let email = sqlx::query_scalar::<_, Option<String>>(
                "SELECT email FROM players WHERE id = $1 AND tenant_id = $2",
            )
            .bind(player.id)
            .bind(tenant_id)
            .fetch_one(&state.db)
            .await?
            .unwrap_or_default();

            let customer = stripe.create_customer(&email, &org_name, &org_id).await?;
            let cid = customer["id"].as_str().unwrap_or("").to_string();

            sqlx::query("UPDATE organisations SET stripe_customer_id = $1 WHERE id = $2 AND tenant_id = $3")
                .bind(&cid)
                .bind(&org_id)
                .bind(tenant_id)
                .execute(&state.db)
                .await?;
            cid
        }
    };

    // Determine price ID
    let price_id = body.price_id.clone().unwrap_or_else(|| {
        match body.plan_tier.as_deref() {
            Some("pro") => state.config.stripe.price_pro.clone(),
            Some("enterprise") => state.config.stripe.price_enterprise.clone(),
            _ => state.config.stripe.price_starter.clone(),
        }
    });

    let trial_days = if body.trial.unwrap_or(false) {
        let used = subscription_sync::has_used_trial(&state.db, player.id, tenant_id).await?;
        if used { None } else { Some(state.config.stripe.trial_days) }
    } else {
        None
    };

    let sub = stripe
        .create_subscription(&customer_id, &price_id, trial_days, &org_id, tenant_id)
        .await?;

    // Sync to DB
    subscription_sync::sync_from_stripe(&state.db, &state.cache, &sub, tenant_id).await?;

    if trial_days.is_some() {
        subscription_sync::record_trial_start(&state.db, player.id, tenant_id, &org_id).await?;
    }

    Ok(Json(json!({
        "subscription": {
            "id": sub["id"],
            "status": sub["status"],
            "clientSecret": sub["latest_invoice"]["payment_intent"]["client_secret"],
        }
    })))
}

pub async fn portal(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Json(body): Json<PortalRequest>,
) -> AppResult<Json<Value>> {
    let stripe = state.stripe.as_ref()
        .ok_or_else(|| AppError::Internal("Stripe not configured".into()))?;

    let cid: Option<String> = sqlx::query_scalar(
        "SELECT stripe_customer_id FROM organisations WHERE id = $1 AND tenant_id = $2",
    )
    .bind(&body.organisation_id)
    .bind(&tenant.0 .0)
    .fetch_optional(&state.db)
    .await?
    .flatten();

    let cid = cid.ok_or_else(|| AppError::NotFound("No Stripe customer found".into()))?;
    let session = stripe.create_billing_portal(&cid, &state.config.stripe.portal_return_url).await?;

    Ok(Json(json!({ "url": session["url"] })))
}

pub async fn plans(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let rows: Vec<PlanDefinition> = sqlx::query_as(
        "SELECT * FROM plan_definitions WHERE tenant_id = $1 AND is_active = true ORDER BY sort_order",
    )
    .bind(&tenant.0 .0)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "plans": rows,
        "pricingTableId": state.config.stripe.pricing_table_id,
    })))
}

pub async fn subscription_status(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let tenant_id = &tenant.0 .0;

    // Get player's org subscription
    let sub: Option<Subscription> = sqlx::query_as(
        r#"SELECT s.* FROM subscriptions s
        JOIN organisation_members om ON om.organisation_id = s.organisation_id AND om.tenant_id = s.tenant_id
        WHERE om.player_id = $1 AND om.tenant_id = $2 AND s.status IN ('active', 'trialing', 'past_due')
        ORDER BY s.updated_at DESC LIMIT 1"#,
    )
    .bind(player.id)
    .bind(tenant_id)
    .fetch_optional(&state.db)
    .await?;

    let trial_eligible = !subscription_sync::has_used_trial(&state.db, player.id, tenant_id).await?;

    Ok(Json(json!({
        "subscription": sub,
        "trialEligible": trial_eligible,
    })))
}

pub async fn cancel(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Json(body): Json<CancelRequest>,
) -> AppResult<Json<Value>> {
    let stripe = state.stripe.as_ref()
        .ok_or_else(|| AppError::Internal("Stripe not configured".into()))?;

    let sub_id: Option<String> = sqlx::query_scalar(
        "SELECT stripe_subscription_id FROM subscriptions WHERE organisation_id = $1 AND tenant_id = $2 AND status IN ('active', 'trialing') LIMIT 1",
    )
    .bind(&body.organisation_id)
    .bind(&tenant.0 .0)
    .fetch_optional(&state.db)
    .await?;

    let sub_id = sub_id.ok_or_else(|| AppError::NotFound("No active subscription".into()))?;
    let result = stripe.cancel_subscription(&sub_id, body.immediate.unwrap_or(false)).await?;
    subscription_sync::sync_from_stripe(&state.db, &state.cache, &result, &tenant.0 .0).await?;

    Ok(Json(json!({"success": true, "status": result["status"]})))
}

pub async fn resume(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Json(body): Json<ResumeRequest>,
) -> AppResult<Json<Value>> {
    let stripe = state.stripe.as_ref()
        .ok_or_else(|| AppError::Internal("Stripe not configured".into()))?;

    let sub_id: Option<String> = sqlx::query_scalar(
        "SELECT stripe_subscription_id FROM subscriptions WHERE organisation_id = $1 AND tenant_id = $2 AND status = 'active' LIMIT 1",
    )
    .bind(&body.organisation_id)
    .bind(&tenant.0 .0)
    .fetch_optional(&state.db)
    .await?;

    let sub_id = sub_id.ok_or_else(|| AppError::NotFound("No active subscription".into()))?;
    let result = stripe.resume_subscription(&sub_id).await?;
    subscription_sync::sync_from_stripe(&state.db, &state.cache, &result, &tenant.0 .0).await?;

    Ok(Json(json!({"success": true})))
}

pub async fn usage(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let tenant_id = &tenant.0 .0;

    let org_id: Option<String> = sqlx::query_scalar(
        "SELECT organisation_id FROM organisation_members WHERE player_id = $1 AND tenant_id = $2 LIMIT 1",
    )
    .bind(player.id)
    .bind(tenant_id)
    .fetch_optional(&state.db)
    .await?;

    let org_id = org_id.ok_or_else(|| AppError::NotFound("No organisation".into()))?;

    let meters = usage_meters::get_all_statuses(&state.db, &org_id, tenant_id).await?;
    let storage = storage_quotas::get_usage_breakdown(&state.db, &org_id).await?;
    let total_bytes = storage_quotas::get_total_usage(&state.db, &state.cache, &org_id).await?;

    Ok(Json(json!({
        "meters": meters,
        "storage": { "totalBytes": total_bytes, "breakdown": storage },
    })))
}

pub async fn entitlements(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let org_id: Option<String> = sqlx::query_scalar(
        "SELECT organisation_id FROM organisation_members WHERE player_id = $1 AND tenant_id = $2 LIMIT 1",
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .fetch_optional(&state.db)
    .await?;

    match org_id {
        Some(oid) => {
            let ents = crate::middleware::entitlements::get_all_entitlements(
                &state.db, &state.cache, &oid, &tenant.0 .0,
            ).await?;
            Ok(Json(json!({"entitlements": ents})))
        }
        None => Ok(Json(json!({"entitlements": {}}))),
    }
}

pub async fn upgrade_badge(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let tenant_id = &tenant.0 .0;

    let org_id: Option<String> = sqlx::query_scalar(
        "SELECT organisation_id FROM organisation_members WHERE player_id = $1 AND tenant_id = $2 LIMIT 1",
    )
    .bind(player.id)
    .bind(tenant_id)
    .fetch_optional(&state.db)
    .await?;

    let org_id = match org_id {
        Some(id) => id,
        None => return Ok(Json(json!({"showBadge": false}))),
    };

    let plan = subscription_sync::get_effective_plan(&state.db, &org_id).await?;
    let meters = usage_meters::get_all_statuses(&state.db, &org_id, tenant_id).await?;

    let high_usage = meters.iter().any(|m| m.usage_pct.unwrap_or(0.0) > 80.0);

    Ok(Json(json!({
        "showBadge": high_usage && plan != "enterprise",
        "currentPlan": plan,
        "meters": meters,
    })))
}
