use axum::{extract::State, Json};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::{generate_tokens, verify_token};
use crate::middleware::tenant::TenantId;
use crate::models::player::*;
use crate::AppState;

pub async fn guest(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Json(body): Json<GuestRequest>,
) -> AppResult<Json<Value>> {
    let tenant_id = &tenant.0 .0;
    let player_id = body
        .player_id
        .and_then(|id| Uuid::parse_str(&id).ok())
        .unwrap_or_else(Uuid::new_v4);
    let display_name = body
        .display_name
        .unwrap_or_else(|| format!("Explorer_{}", &player_id.to_string()[..8]));
    let avatar = body.avatar_character.unwrap_or_else(|| "robot".to_string());

    let player: Player = sqlx::query_as(
        r#"INSERT INTO players (id, tenant_id, display_name, avatar_character, is_guest, total_score, games_played)
        VALUES ($1, $2, $3, $4, true, 0, 0)
        ON CONFLICT (id, tenant_id) DO UPDATE SET last_login_at = NOW()
        RETURNING *"#,
    )
    .bind(player_id)
    .bind(tenant_id)
    .bind(&display_name)
    .bind(&avatar)
    .fetch_one(&state.db)
    .await?;

    let (token, refresh_token) = generate_tokens(
        player.id,
        tenant_id,
        None,
        &state.config.jwt.secret,
        state.config.jwt.access_expiry_secs,
        state.config.jwt.refresh_expiry_secs,
    )?;

    Ok(Json(json!({
        "token": token,
        "refreshToken": refresh_token,
        "player": PlayerPublic::from(&player)
    })))
}

pub async fn register(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Json(body): Json<RegisterRequest>,
) -> AppResult<Json<Value>> {
    let tenant_id = &tenant.0 .0;

    if body.email.is_empty() || body.password.len() < 6 {
        return Err(AppError::BadRequest(
            "Email required and password must be at least 6 characters".into(),
        ));
    }

    // Check email uniqueness
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM players WHERE email = $1 AND tenant_id = $2 AND is_guest = false)",
    )
    .bind(&body.email)
    .bind(tenant_id)
    .fetch_one(&state.db)
    .await?;

    if exists {
        return Err(AppError::Conflict("Email already registered".into()));
    }

    let password_hash =
        bcrypt::hash(&body.password, 12).map_err(|e| AppError::Internal(e.to_string()))?;

    let player_id = body
        .player_id
        .and_then(|id| Uuid::parse_str(&id).ok())
        .unwrap_or_else(Uuid::new_v4);
    let display_name = body
        .display_name
        .unwrap_or_else(|| format!("Player_{}", &player_id.to_string()[..8]));
    let avatar = body
        .avatar_character
        .unwrap_or_else(|| "robot".to_string());

    let player: Player = sqlx::query_as(
        r#"INSERT INTO players (id, tenant_id, email, password_hash, display_name, avatar_character, is_guest, total_score, games_played)
        VALUES ($1, $2, $3, $4, $5, $6, false, 0, 0)
        ON CONFLICT (id, tenant_id) DO UPDATE SET
            email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, is_guest = false
        RETURNING *"#,
    )
    .bind(player_id)
    .bind(tenant_id)
    .bind(&body.email)
    .bind(&password_hash)
    .bind(&display_name)
    .bind(&avatar)
    .fetch_one(&state.db)
    .await?;

    let progress: Vec<(String, i64, i32, i32)> = sqlx::query_as(
        "SELECT game_id, high_score, stars, play_count FROM game_progress WHERE player_id = $1 AND tenant_id = $2",
    )
    .bind(player.id)
    .bind(tenant_id)
    .fetch_all(&state.db)
    .await?;

    let (token, refresh_token) = generate_tokens(
        player.id,
        tenant_id,
        None,
        &state.config.jwt.secret,
        state.config.jwt.access_expiry_secs,
        state.config.jwt.refresh_expiry_secs,
    )?;

    let progress_map: serde_json::Map<String, Value> = progress
        .into_iter()
        .map(|(gid, hs, stars, pc)| {
            (gid, json!({"highScore": hs, "stars": stars, "playCount": pc}))
        })
        .collect();

    Ok(Json(json!({
        "token": token,
        "refreshToken": refresh_token,
        "player": PlayerPublic::from(&player),
        "progress": progress_map,
    })))
}

pub async fn login(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Json(body): Json<LoginRequest>,
) -> AppResult<Json<Value>> {
    let tenant_id = &tenant.0 .0;

    let player: Player = sqlx::query_as(
        "SELECT * FROM players WHERE email = $1 AND tenant_id = $2 AND is_guest = false",
    )
    .bind(&body.email)
    .bind(tenant_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Unauthorized("Invalid email or password".into()))?;

    let hash = player
        .password_hash
        .as_deref()
        .ok_or_else(|| AppError::Unauthorized("Invalid email or password".into()))?;

    let valid =
        bcrypt::verify(&body.password, hash).map_err(|e| AppError::Internal(e.to_string()))?;
    if !valid {
        return Err(AppError::Unauthorized(
            "Invalid email or password".into(),
        ));
    }

    // Update last login
    sqlx::query("UPDATE players SET last_login_at = NOW() WHERE id = $1 AND tenant_id = $2")
        .bind(player.id)
        .bind(tenant_id)
        .execute(&state.db)
        .await?;

    let progress: Vec<(String, i64, i32, i32)> = sqlx::query_as(
        "SELECT game_id, high_score, stars, play_count FROM game_progress WHERE player_id = $1 AND tenant_id = $2",
    )
    .bind(player.id)
    .bind(tenant_id)
    .fetch_all(&state.db)
    .await?;

    let (token, refresh_token) = generate_tokens(
        player.id,
        tenant_id,
        player.admin_role.as_deref(),
        &state.config.jwt.secret,
        state.config.jwt.access_expiry_secs,
        state.config.jwt.refresh_expiry_secs,
    )?;

    let progress_map: serde_json::Map<String, Value> = progress
        .into_iter()
        .map(|(gid, hs, stars, pc)| {
            (gid, json!({"highScore": hs, "stars": stars, "playCount": pc}))
        })
        .collect();

    Ok(Json(json!({
        "token": token,
        "refreshToken": refresh_token,
        "player": PlayerPublic::from(&player),
        "progress": progress_map,
    })))
}

pub async fn refresh(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let token = body["refreshToken"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("refreshToken required".into()))?;

    let claims = verify_token(token, &state.config.jwt.secret)?;
    if claims.token_type.as_deref() != Some("refresh") {
        return Err(AppError::Unauthorized("Refresh token required".into()));
    }

    let player_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| AppError::Unauthorized("Invalid token".into()))?;

    let (new_token, new_refresh) = generate_tokens(
        player_id,
        &claims.tenant_id,
        claims.role.as_deref(),
        &state.config.jwt.secret,
        state.config.jwt.access_expiry_secs,
        state.config.jwt.refresh_expiry_secs,
    )?;

    Ok(Json(json!({
        "token": new_token,
        "refreshToken": new_refresh,
    })))
}
