use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::AppResult;
use crate::middleware::auth::AuthPlayer;
use crate::middleware::tenant::TenantId;
use crate::services::leaderboard;
use crate::AppState;

#[derive(Deserialize)]
pub struct PaginationQuery {
    pub offset: Option<i64>,
    pub limit: Option<i64>,
}

pub async fn get_game_leaderboard(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Path(game_id): Path<String>,
    Query(q): Query<PaginationQuery>,
) -> AppResult<Json<Value>> {
    let tenant_id = &tenant.0 .0;
    let limit = q.limit.unwrap_or(50).min(100) as usize;

    // Try cache first
    let entries = leaderboard::get_top_k(
        &state.cache,
        tenant_id,
        &game_id,
        limit,
        state.config.leaderboard.shard_count,
    )
    .await;

    if !entries.is_empty() {
        let results: Vec<Value> = entries
            .iter()
            .enumerate()
            .map(|(i, (pid, score))| {
                json!({"rank": i + 1, "playerId": pid, "score": *score as i64})
            })
            .collect();
        return Ok(Json(json!({ "entries": results, "source": "cache" })));
    }

    // Fallback to DB
    let rows: Vec<(String, i64, String, i64)> = sqlx::query_as(
        r#"SELECT p.id::text, gp.high_score, p.display_name,
            RANK() OVER (ORDER BY gp.high_score DESC)::bigint as rank
        FROM game_progress gp
        JOIN players p ON p.id = gp.player_id AND p.tenant_id = gp.tenant_id
        WHERE gp.tenant_id = $1 AND gp.game_id = $2
        ORDER BY gp.high_score DESC
        LIMIT $3"#,
    )
    .bind(tenant_id)
    .bind(&game_id)
    .bind(limit as i64)
    .fetch_all(&state.db)
    .await?;

    let results: Vec<Value> = rows
        .iter()
        .map(|(pid, score, name, rank)| {
            json!({"rank": rank, "playerId": pid, "displayName": name, "score": score})
        })
        .collect();

    Ok(Json(json!({ "entries": results, "source": "db" })))
}

pub async fn get_my_rank(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(game_id): Path<String>,
) -> AppResult<Json<Value>> {
    let tenant_id = &tenant.0 .0;
    let pid = player.id.to_string();

    // Try cache
    if let Some(rank) = leaderboard::get_approx_rank(
        &state.cache,
        tenant_id,
        &game_id,
        &pid,
        state.config.leaderboard.shard_count,
    )
    .await
    {
        return Ok(Json(json!({"rank": rank, "source": "cache"})));
    }

    // Fallback to DB
    let score: Option<i64> = sqlx::query_scalar(
        "SELECT high_score FROM game_progress WHERE player_id = $1 AND tenant_id = $2 AND game_id = $3",
    )
    .bind(player.id)
    .bind(tenant_id)
    .bind(&game_id)
    .fetch_optional(&state.db)
    .await?;

    match score {
        Some(s) => {
            let rank: i64 = sqlx::query_scalar(
                "SELECT COUNT(*)::bigint + 1 FROM game_progress WHERE tenant_id = $1 AND game_id = $2 AND high_score > $3",
            )
            .bind(tenant_id)
            .bind(&game_id)
            .bind(s)
            .fetch_one(&state.db)
            .await?;
            Ok(Json(json!({"rank": rank, "score": s})))
        }
        None => Ok(Json(json!({"rank": null, "score": 0}))),
    }
}

pub async fn get_around_me(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(game_id): Path<String>,
) -> AppResult<Json<Value>> {
    let tenant_id = &tenant.0 .0;

    let my_score: Option<i64> = sqlx::query_scalar(
        "SELECT high_score FROM game_progress WHERE player_id = $1 AND tenant_id = $2 AND game_id = $3",
    )
    .bind(player.id)
    .bind(tenant_id)
    .bind(&game_id)
    .fetch_optional(&state.db)
    .await?;

    let score = match my_score {
        Some(s) => s,
        None => return Ok(Json(json!({"entries": []}))),
    };

    let rows: Vec<(String, i64, String)> = sqlx::query_as(
        r#"(SELECT p.id::text, gp.high_score, p.display_name
            FROM game_progress gp JOIN players p ON p.id = gp.player_id AND p.tenant_id = gp.tenant_id
            WHERE gp.tenant_id = $1 AND gp.game_id = $2 AND gp.high_score > $3
            ORDER BY gp.high_score ASC LIMIT 5)
        UNION ALL
        (SELECT p.id::text, gp.high_score, p.display_name
            FROM game_progress gp JOIN players p ON p.id = gp.player_id AND p.tenant_id = gp.tenant_id
            WHERE gp.tenant_id = $1 AND gp.game_id = $2 AND gp.high_score <= $3
            ORDER BY gp.high_score DESC LIMIT 5)"#,
    )
    .bind(tenant_id)
    .bind(&game_id)
    .bind(score)
    .fetch_all(&state.db)
    .await?;

    let entries: Vec<Value> = rows
        .iter()
        .map(|(pid, s, name)| json!({"playerId": pid, "score": s, "displayName": name}))
        .collect();

    Ok(Json(json!({ "entries": entries })))
}

pub async fn get_global_leaderboard(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Query(q): Query<PaginationQuery>,
) -> AppResult<Json<Value>> {
    let tenant_id = &tenant.0 .0;
    let limit = q.limit.unwrap_or(50).min(100);

    let rows: Vec<(String, i64, String)> = sqlx::query_as(
        "SELECT id::text, total_score, display_name FROM players WHERE tenant_id = $1 ORDER BY total_score DESC LIMIT $2",
    )
    .bind(tenant_id)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    let entries: Vec<Value> = rows
        .iter()
        .enumerate()
        .map(|(i, (pid, score, name))| {
            json!({"rank": i + 1, "playerId": pid, "displayName": name, "totalScore": score})
        })
        .collect();

    Ok(Json(json!({ "entries": entries })))
}

pub async fn get_friends_leaderboard(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(game_id): Path<String>,
) -> AppResult<Json<Value>> {
    let tenant_id = &tenant.0 .0;

    let rows: Vec<(String, i64, String)> = sqlx::query_as(
        r#"SELECT p.id::text, gp.high_score, p.display_name
        FROM game_progress gp
        JOIN players p ON p.id = gp.player_id AND p.tenant_id = gp.tenant_id
        WHERE gp.tenant_id = $1 AND gp.game_id = $2 AND (
            gp.player_id = $3 OR
            gp.player_id IN (
                SELECT CASE WHEN player_id = $3 THEN friend_id ELSE player_id END
                FROM friendships WHERE tenant_id = $1 AND status = 'accepted'
                    AND (player_id = $3 OR friend_id = $3)
            )
        )
        ORDER BY gp.high_score DESC LIMIT 50"#,
    )
    .bind(tenant_id)
    .bind(&game_id)
    .bind(player.id)
    .fetch_all(&state.db)
    .await?;

    let entries: Vec<Value> = rows
        .iter()
        .enumerate()
        .map(|(i, (pid, score, name))| {
            json!({"rank": i + 1, "playerId": pid, "displayName": name, "score": score})
        })
        .collect();

    Ok(Json(json!({ "entries": entries })))
}

pub async fn get_ranked_leaderboard(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Path(game_id): Path<String>,
    Query(q): Query<PaginationQuery>,
) -> AppResult<Json<Value>> {
    let tenant_id = &tenant.0 .0;
    let limit = q.limit.unwrap_or(50).min(100);

    let rows: Vec<(String, i64, f64, i32, i32)> = sqlx::query_as(
        r#"SELECT le.player_id::text, le.score, le.skill_rating, le.wins, le.matches_played
        FROM leaderboard_entries le
        WHERE le.tenant_id = $1 AND le.game_id = $2 AND le.region = 'global'
        ORDER BY le.skill_rating DESC
        LIMIT $3"#,
    )
    .bind(tenant_id)
    .bind(&game_id)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    let entries: Vec<Value> = rows
        .iter()
        .enumerate()
        .map(|(i, (pid, score, rating, wins, matches))| {
            json!({"rank": i + 1, "playerId": pid, "score": score, "skillRating": rating, "wins": wins, "matchesPlayed": matches})
        })
        .collect();

    Ok(Json(json!({ "entries": entries })))
}

pub async fn get_seasons(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let rows: Vec<(String, String, chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>, bool)> = sqlx::query_as(
        "SELECT id, name, starts_at, ends_at, is_active FROM seasons WHERE tenant_id = $1 ORDER BY starts_at DESC LIMIT 20",
    )
    .bind(&tenant.0 .0)
    .fetch_all(&state.db)
    .await?;

    let seasons: Vec<Value> = rows
        .iter()
        .map(|(id, name, start, end, active)| {
            json!({"id": id, "name": name, "startsAt": start, "endsAt": end, "isActive": active})
        })
        .collect();

    Ok(Json(json!({ "seasons": seasons })))
}

pub async fn get_current_season(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let row: Option<(String, String, chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT id, name, starts_at, ends_at FROM seasons WHERE tenant_id = $1 AND is_active = true LIMIT 1",
    )
    .bind(&tenant.0 .0)
    .fetch_optional(&state.db)
    .await?;

    match row {
        Some((id, name, start, end)) => Ok(Json(json!({
            "id": id, "name": name, "startsAt": start, "endsAt": end, "isActive": true
        }))),
        None => Ok(Json(json!({ "season": null }))),
    }
}

pub async fn submit_match(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Json(body): Json<crate::models::multiplayer::SubmitMatchRequest>,
) -> AppResult<Json<Value>> {
    let tenant_id = &tenant.0 .0;

    for pr in &body.players {
        let player_id = uuid::Uuid::parse_str(&pr.player_id)
            .map_err(|_| crate::error::AppError::BadRequest("Invalid player ID".into()))?;

        // Upsert global leaderboard entry
        sqlx::query(
            r#"INSERT INTO leaderboard_entries (tenant_id, player_id, game_id, region, score, wins, losses, draws, matches_played, skill_rating, updated_at)
            VALUES ($1, $2, $3, 'global', $4, $5, $6, 0, 1, 1000, NOW())
            ON CONFLICT (tenant_id, player_id, game_id, region) DO UPDATE SET
                score = leaderboard_entries.score + EXCLUDED.score,
                wins = leaderboard_entries.wins + EXCLUDED.wins,
                losses = leaderboard_entries.losses + EXCLUDED.losses,
                matches_played = leaderboard_entries.matches_played + 1,
                updated_at = NOW()"#,
        )
        .bind(tenant_id)
        .bind(player_id)
        .bind(&body.game_id)
        .bind(pr.score)
        .bind(if pr.is_winner { 1i32 } else { 0 })
        .bind(if pr.is_winner { 0i32 } else { 1 })
        .execute(&state.db)
        .await?;
    }

    Ok(Json(json!({"success": true})))
}
