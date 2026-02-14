use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthPlayer;
use crate::middleware::tenant::TenantId;
use crate::models::compliance::*;
use crate::AppState;

pub async fn get_consent(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let row: Option<(Option<bool>, Option<chrono::DateTime<chrono::Utc>>)> = sqlx::query_as(
        "SELECT gdpr_consent, gdpr_consent_at FROM players WHERE id = $1 AND tenant_id = $2",
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .fetch_optional(&state.db)
    .await?;

    match row {
        Some((consent, at)) => Ok(Json(json!({"consent": consent.unwrap_or(false), "consentAt": at}))),
        None => Ok(Json(json!({"consent": false}))),
    }
}

pub async fn record_consent(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Json(body): Json<ConsentRequest>,
) -> AppResult<Json<Value>> {
    sqlx::query(
        "UPDATE players SET gdpr_consent = $1, gdpr_consent_at = NOW() WHERE id = $2 AND tenant_id = $3",
    )
    .bind(body.consent)
    .bind(player.id)
    .bind(&tenant.0 .0)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({"success": true})))
}

pub async fn request_export(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let tid = &tenant.0 .0;

    let req_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO gdpr_requests (id, tenant_id, player_id, request_type, status, created_at)
        VALUES (gen_random_uuid(), $1, $2, 'export', 'pending', NOW())
        RETURNING id"#,
    )
    .bind(tid)
    .bind(player.id)
    .fetch_one(&state.db)
    .await?;

    // Process export inline (in production this would be async)
    let pid = player.id;
    let db = state.db.clone();
    let tenant_id = tid.clone();
    tokio::spawn(async move {
        let _ = process_export(&db, pid, &tenant_id, req_id).await;
    });

    Ok(Json(json!({"requestId": req_id, "status": "pending"})))
}

async fn process_export(
    db: &sqlx::PgPool,
    player_id: Uuid,
    tenant_id: &str,
    request_id: Uuid,
) -> AppResult<()> {
    // Collect player data
    let profile: Option<Value> = sqlx::query_scalar(
        "SELECT row_to_json(p) FROM (SELECT id, email, display_name, avatar_character, total_score, games_played, created_at FROM players WHERE id = $1 AND tenant_id = $2) p",
    )
    .bind(player_id)
    .bind(tenant_id)
    .fetch_optional(db)
    .await?;

    let progress: Vec<Value> = sqlx::query_scalar(
        "SELECT row_to_json(gp) FROM (SELECT game_id, high_score, stars, play_count FROM game_progress WHERE player_id = $1 AND tenant_id = $2) gp",
    )
    .bind(player_id)
    .bind(tenant_id)
    .fetch_all(db)
    .await?;

    let scores: Vec<Value> = sqlx::query_scalar(
        "SELECT row_to_json(sh) FROM (SELECT game_id, score, level, created_at FROM score_history WHERE player_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 1000) sh",
    )
    .bind(player_id)
    .bind(tenant_id)
    .fetch_all(db)
    .await?;

    let export_data = json!({
        "profile": profile,
        "gameProgress": progress,
        "scoreHistory": scores,
        "exportedAt": chrono::Utc::now(),
    });

    let download_url = format!("data:application/json;base64,{}", base64_encode(&export_data.to_string()));
    let expires = chrono::Utc::now() + chrono::Duration::days(7);

    sqlx::query(
        "UPDATE gdpr_requests SET status = 'completed', download_url = $1, completed_at = NOW(), expires_at = $2 WHERE id = $3",
    )
    .bind(&download_url)
    .bind(expires)
    .bind(request_id)
    .execute(db)
    .await?;

    Ok(())
}

fn base64_encode(s: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(s.as_bytes())
}

pub async fn get_export_status(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    let req_id = Uuid::parse_str(&id)
        .map_err(|_| AppError::BadRequest("Invalid request ID".into()))?;

    let row: Option<(String, Option<String>, Option<chrono::DateTime<chrono::Utc>>, Option<chrono::DateTime<chrono::Utc>>)> = sqlx::query_as(
        "SELECT status, download_url, completed_at, expires_at FROM gdpr_requests WHERE id = $1 AND player_id = $2 AND tenant_id = $3 AND request_type = 'export'",
    )
    .bind(req_id)
    .bind(player.id)
    .bind(&tenant.0 .0)
    .fetch_optional(&state.db)
    .await?;

    match row {
        Some((status, url, completed, expires)) => Ok(Json(json!({
            "status": status, "downloadUrl": url, "completedAt": completed, "expiresAt": expires,
        }))),
        None => Err(AppError::NotFound("Export request not found".into())),
    }
}

pub async fn request_deletion(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Json(body): Json<DeleteRequest>,
) -> AppResult<Json<Value>> {
    if body.confirmation != "DELETE_MY_DATA" {
        return Err(AppError::BadRequest(
            "Must confirm with 'DELETE_MY_DATA'".into(),
        ));
    }

    let tid = &tenant.0 .0;

    sqlx::query(
        "UPDATE players SET data_deletion_requested_at = NOW() WHERE id = $1 AND tenant_id = $2",
    )
    .bind(player.id)
    .bind(tid)
    .execute(&state.db)
    .await?;

    sqlx::query(
        "INSERT INTO gdpr_requests (id, tenant_id, player_id, request_type, status, created_at) VALUES (gen_random_uuid(), $1, $2, 'delete', 'pending', NOW())",
    )
    .bind(tid)
    .bind(player.id)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "message": "Deletion scheduled. Your data will be deleted within 30 days.",
    })))
}

pub async fn privacy_policy() -> Json<Value> {
    Json(json!({
        "version": "1.0",
        "lastUpdated": "2025-01-01",
        "dataCollected": ["email", "display name", "game progress", "scores", "purchase history"],
        "retention": "Data retained while account active. Deleted 30 days after deletion request.",
        "rights": ["access", "rectification", "erasure", "portability", "restriction"],
        "contact": "privacy@minigames.cool",
    }))
}
