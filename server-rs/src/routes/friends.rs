use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthPlayer;
use crate::middleware::tenant::TenantId;
use crate::AppState;

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
}

pub async fn list_friends(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let rows: Vec<(Uuid, String, String)> = sqlx::query_as(
        r#"SELECT p.id, p.display_name, p.avatar_character
        FROM friendships f
        JOIN players p ON (
            (f.player_id = $1 AND p.id = f.friend_id) OR
            (f.friend_id = $1 AND p.id = f.player_id)
        ) AND p.tenant_id = $2
        WHERE f.tenant_id = $2 AND f.status = 'accepted'
            AND (f.player_id = $1 OR f.friend_id = $1)"#,
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .fetch_all(&state.db)
    .await?;

    let friends: Vec<Value> = rows.iter().map(|(id, name, avatar)| {
        json!({"playerId": id, "displayName": name, "avatarCharacter": avatar})
    }).collect();

    Ok(Json(json!({ "friends": friends })))
}

pub async fn friend_requests(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let incoming: Vec<(Uuid, String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        r#"SELECT p.id, p.display_name, f.created_at
        FROM friendships f JOIN players p ON p.id = f.player_id AND p.tenant_id = f.tenant_id
        WHERE f.friend_id = $1 AND f.tenant_id = $2 AND f.status = 'pending'"#,
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .fetch_all(&state.db)
    .await?;

    let outgoing: Vec<(Uuid, String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        r#"SELECT p.id, p.display_name, f.created_at
        FROM friendships f JOIN players p ON p.id = f.friend_id AND p.tenant_id = f.tenant_id
        WHERE f.player_id = $1 AND f.tenant_id = $2 AND f.status = 'pending'"#,
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "incoming": incoming.iter().map(|(id, name, created)| json!({"playerId": id, "displayName": name, "createdAt": created})).collect::<Vec<_>>(),
        "outgoing": outgoing.iter().map(|(id, name, created)| json!({"playerId": id, "displayName": name, "createdAt": created})).collect::<Vec<_>>(),
    })))
}

pub async fn online_friends(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let rows: Vec<(Uuid, String, String, Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT p.id, p.display_name, COALESCE(pp.status, 'offline'), pp.current_game_id, pp.current_room_id
        FROM friendships f
        JOIN players p ON (
            (f.player_id = $1 AND p.id = f.friend_id) OR
            (f.friend_id = $1 AND p.id = f.player_id)
        ) AND p.tenant_id = $2
        LEFT JOIN player_presence pp ON pp.player_id = p.id AND pp.tenant_id = $2
        WHERE f.tenant_id = $2 AND f.status = 'accepted' AND (f.player_id = $1 OR f.friend_id = $1)
            AND pp.status IS NOT NULL AND pp.status != 'offline'"#,
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .fetch_all(&state.db)
    .await?;

    let friends: Vec<Value> = rows.iter().map(|(id, name, status, gid, rid)| {
        json!({"playerId": id, "displayName": name, "status": status, "currentGameId": gid, "currentRoomId": rid})
    }).collect();

    Ok(Json(json!({ "friends": friends })))
}

pub async fn send_request(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let target_id = body["playerId"].as_str()
        .ok_or_else(|| AppError::BadRequest("playerId required".into()))?;
    let target = Uuid::parse_str(target_id)
        .map_err(|_| AppError::BadRequest("Invalid player ID".into()))?;
    let tid = &tenant.0 .0;

    if target == player.id {
        return Err(AppError::BadRequest("Cannot friend yourself".into()));
    }

    // Check existing
    let existing: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(SELECT 1 FROM friendships WHERE tenant_id = $1
            AND ((player_id = $2 AND friend_id = $3) OR (player_id = $3 AND friend_id = $2)))"#,
    )
    .bind(tid).bind(player.id).bind(target)
    .fetch_one(&state.db).await?;

    if existing {
        return Err(AppError::Conflict("Friendship already exists".into()));
    }

    sqlx::query(
        "INSERT INTO friendships (tenant_id, player_id, friend_id, status, created_at) VALUES ($1, $2, $3, 'pending', NOW())",
    )
    .bind(tid).bind(player.id).bind(target)
    .execute(&state.db).await?;

    Ok(Json(json!({"success": true})))
}

pub async fn accept_request(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    let from = Uuid::parse_str(&id).map_err(|_| AppError::BadRequest("Invalid ID".into()))?;
    sqlx::query(
        "UPDATE friendships SET status = 'accepted' WHERE tenant_id = $1 AND player_id = $2 AND friend_id = $3 AND status = 'pending'",
    )
    .bind(&tenant.0 .0).bind(from).bind(player.id)
    .execute(&state.db).await?;
    Ok(Json(json!({"success": true})))
}

pub async fn decline_request(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    let from = Uuid::parse_str(&id).map_err(|_| AppError::BadRequest("Invalid ID".into()))?;
    sqlx::query(
        "DELETE FROM friendships WHERE tenant_id = $1 AND player_id = $2 AND friend_id = $3 AND status = 'pending'",
    )
    .bind(&tenant.0 .0).bind(from).bind(player.id)
    .execute(&state.db).await?;
    Ok(Json(json!({"success": true})))
}

pub async fn remove_friend(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    let friend = Uuid::parse_str(&id).map_err(|_| AppError::BadRequest("Invalid ID".into()))?;
    sqlx::query(
        r#"DELETE FROM friendships WHERE tenant_id = $1 AND status = 'accepted'
            AND ((player_id = $2 AND friend_id = $3) OR (player_id = $3 AND friend_id = $2))"#,
    )
    .bind(&tenant.0 .0).bind(player.id).bind(friend)
    .execute(&state.db).await?;
    Ok(Json(json!({"success": true})))
}

pub async fn block_player(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    let target = Uuid::parse_str(&id).map_err(|_| AppError::BadRequest("Invalid ID".into()))?;
    let tid = &tenant.0 .0;
    // Remove existing friendship
    sqlx::query(
        r#"DELETE FROM friendships WHERE tenant_id = $1
            AND ((player_id = $2 AND friend_id = $3) OR (player_id = $3 AND friend_id = $2))"#,
    )
    .bind(tid).bind(player.id).bind(target)
    .execute(&state.db).await?;
    // Insert block
    sqlx::query(
        "INSERT INTO friendships (tenant_id, player_id, friend_id, status, created_at) VALUES ($1, $2, $3, 'blocked', NOW()) ON CONFLICT DO NOTHING",
    )
    .bind(tid).bind(player.id).bind(target)
    .execute(&state.db).await?;
    Ok(Json(json!({"success": true})))
}

pub async fn unblock_player(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    let target = Uuid::parse_str(&id).map_err(|_| AppError::BadRequest("Invalid ID".into()))?;
    sqlx::query(
        "DELETE FROM friendships WHERE tenant_id = $1 AND player_id = $2 AND friend_id = $3 AND status = 'blocked'",
    )
    .bind(&tenant.0 .0).bind(player.id).bind(target)
    .execute(&state.db).await?;
    Ok(Json(json!({"success": true})))
}

pub async fn blocked_list(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let rows: Vec<(Uuid, String)> = sqlx::query_as(
        r#"SELECT p.id, p.display_name FROM friendships f
        JOIN players p ON p.id = f.friend_id AND p.tenant_id = f.tenant_id
        WHERE f.tenant_id = $1 AND f.player_id = $2 AND f.status = 'blocked'"#,
    )
    .bind(&tenant.0 .0).bind(player.id)
    .fetch_all(&state.db).await?;

    let blocked: Vec<Value> = rows.iter().map(|(id, name)| json!({"playerId": id, "displayName": name})).collect();
    Ok(Json(json!({ "blocked": blocked })))
}

pub async fn invite_to_game(
    State(_state): State<AppState>,
    _player: axum::Extension<AuthPlayer>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    // In production this would send via WebSocket
    Ok(Json(json!({"success": true, "message": "Invite sent", "targetId": id})))
}

pub async fn search_players(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Query(q): Query<SearchQuery>,
) -> AppResult<Json<Value>> {
    let search = format!("%{}%", q.q.as_deref().unwrap_or(""));

    let rows: Vec<(Uuid, String, String)> = sqlx::query_as(
        "SELECT id, display_name, avatar_character FROM players WHERE tenant_id = $1 AND id != $2 AND display_name ILIKE $3 LIMIT 20",
    )
    .bind(&tenant.0 .0).bind(player.id).bind(&search)
    .fetch_all(&state.db).await?;

    let results: Vec<Value> = rows.iter().map(|(id, name, avatar)| {
        json!({"playerId": id, "displayName": name, "avatarCharacter": avatar})
    }).collect();

    Ok(Json(json!({ "players": results })))
}
