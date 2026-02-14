use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde_json::json;

use crate::error::AppResult;
use crate::services::subscription_sync;
use crate::AppState;

pub async fn stripe_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, StatusCode> {
    let stripe = match &state.stripe {
        Some(s) => s,
        None => return Ok(StatusCode::OK),
    };

    let sig = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let event = match stripe.verify_webhook_signature(&body, sig) {
        Ok(e) => e,
        Err(_) => return Err(StatusCode::BAD_REQUEST),
    };

    let event_id = event["id"].as_str().unwrap_or("");
    let event_type = event["type"].as_str().unwrap_or("");
    let tenant_id = event["data"]["object"]["metadata"]["tenantId"]
        .as_str()
        .unwrap_or("stem_default");

    // Idempotency check
    let already_processed: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM stripe_events WHERE id = $1)",
    )
    .bind(event_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(false);

    if already_processed {
        return Ok(StatusCode::OK);
    }

    let result = match event_type {
        "customer.subscription.created"
        | "customer.subscription.updated"
        | "customer.subscription.deleted"
        | "customer.subscription.trial_will_end" => {
            let sub = &event["data"]["object"];
            subscription_sync::sync_from_stripe(&state.db, &state.cache, sub, tenant_id).await
        }
        "invoice.payment_succeeded" | "invoice.payment_failed" => {
            let sub_id = event["data"]["object"]["subscription"]
                .as_str()
                .unwrap_or("");
            if !sub_id.is_empty() {
                if let Some(stripe_client) = &state.stripe {
                    if let Ok(sub) = stripe_client.get_subscription(sub_id).await {
                        subscription_sync::sync_from_stripe(&state.db, &state.cache, &sub, tenant_id)
                            .await
                    } else {
                        Ok(())
                    }
                } else {
                    Ok(())
                }
            } else {
                Ok(())
            }
        }
        "checkout.session.completed" => {
            let sub_id = event["data"]["object"]["subscription"]
                .as_str()
                .unwrap_or("");
            if !sub_id.is_empty() {
                if let Some(stripe_client) = &state.stripe {
                    if let Ok(sub) = stripe_client.get_subscription(sub_id).await {
                        subscription_sync::sync_from_stripe(&state.db, &state.cache, &sub, tenant_id)
                            .await
                    } else {
                        Ok(())
                    }
                } else {
                    Ok(())
                }
            } else {
                Ok(())
            }
        }
        _ => Ok(()),
    };

    let status = if result.is_ok() { "processed" } else { "failed" };

    // Record event
    let _ = sqlx::query(
        "INSERT INTO stripe_events (id, tenant_id, event_type, payload, status) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING",
    )
    .bind(event_id)
    .bind(tenant_id)
    .bind(event_type)
    .bind(&event)
    .bind(status)
    .execute(&state.db)
    .await;

    Ok(StatusCode::OK)
}
