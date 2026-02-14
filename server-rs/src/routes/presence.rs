use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthPlayer;
use crate::middleware::tenant::TenantId;
use crate::models::multiplayer::PresenceUpdateRequest;
use crate::AppState;

pub async fn get_my_presence(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let row: Option<(String, Option<String>, Option<String>, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT status, current_game_id, current_room_id, last_seen_at FROM player_presence WHERE player_id = $1 AND tenant_id = $2",
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .fetch_optional(&state.db)
    .await?;

    match row {
        Some((status, gid, rid, seen)) => Ok(Json(json!({
            "status": status, "currentGameId": gid, "currentRoomId": rid, "lastSeenAt": seen
        }))),
        None => Ok(Json(json!({"status": "offline"}))),
    }
}

pub async fn update_presence(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Json(body): Json<PresenceUpdateRequest>,
) -> AppResult<Json<Value>> {
    let valid_statuses = ["online", "in_game", "in_lobby", "away", "offline"];
    if !valid_statuses.contains(&body.status.as_str()) {
        return Err(AppError::BadRequest("Invalid status".into()));
    }

    sqlx::query(
        r#"INSERT INTO player_presence (player_id, tenant_id, status, current_game_id, current_room_id, last_seen_at, connected_at, server_node)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), 'api')
        ON CONFLICT (player_id, tenant_id) DO UPDATE SET
            status = EXCLUDED.status,
            current_game_id = EXCLUDED.current_game_id,
            current_room_id = EXCLUDED.current_room_id,
            last_seen_at = NOW()"#,
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .bind(&body.status)
    .bind(&body.current_game_id)
    .bind(&body.current_room_id)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({"success": true})))
}

pub async fn heartbeat(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    sqlx::query(
        "UPDATE player_presence SET last_seen_at = NOW() WHERE player_id = $1 AND tenant_id = $2",
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({"success": true})))
}

pub async fn get_player_presence(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    let pid = Uuid::parse_str(&id).map_err(|_| AppError::BadRequest("Invalid player ID".into()))?;

    let row: Option<(String, Option<String>, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT status, current_game_id, last_seen_at FROM player_presence WHERE player_id = $1 AND tenant_id = $2",
    )
    .bind(pid)
    .bind(&tenant.0 .0)
    .fetch_optional(&state.db)
    .await?;

    match row {
        Some((status, gid, seen)) => {
            // If last seen > 5 min ago, consider offline
            let now = chrono::Utc::now();
            let diff = now.signed_duration_since(seen);
            let effective_status = if diff.num_seconds() > 300 { "offline" } else { &status };
            Ok(Json(json!({"status": effective_status, "currentGameId": gid, "lastSeenAt": seen})))
        }
        None => Ok(Json(json!({"status": "offline"}))),
    }
}
