use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthPlayer;
use crate::middleware::tenant::TenantId;
use crate::models::game_progress::*;
use crate::services::{achievements, leaderboard};
use crate::AppState;

pub async fn submit_score(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(game_id): Path<String>,
    Json(body): Json<ScoreSubmitRequest>,
) -> AppResult<Json<Value>> {
    let player_id = player.id;
    let tenant_id = &tenant.0 .0;

    // Validate score range
    if body.score < 0 || body.score > 999_999 {
        return Err(AppError::BadRequest(
            "Score must be between 0 and 999999".into(),
        ));
    }

    let mut tx = state.db.begin().await?;

    // Upsert game_progress
    let prev: Option<(i64, i32)> = sqlx::query_as(
        "SELECT high_score, stars FROM game_progress WHERE player_id = $1 AND tenant_id = $2 AND game_id = $3",
    )
    .bind(player_id)
    .bind(tenant_id)
    .bind(&game_id)
    .fetch_optional(&mut *tx)
    .await?;

    let prev_high = prev.map(|p| p.0).unwrap_or(0);

    sqlx::query(
        r#"INSERT INTO game_progress (player_id, tenant_id, game_id, high_score, best_time, level, play_count, total_score, stars, last_played_at)
        VALUES ($1, $2, $3, $4, $5, $6, 1, $4, 0, NOW())
        ON CONFLICT (player_id, tenant_id, game_id) DO UPDATE SET
            high_score = GREATEST(game_progress.high_score, EXCLUDED.high_score),
            best_time = CASE
                WHEN EXCLUDED.best_time IS NOT NULL AND (game_progress.best_time IS NULL OR EXCLUDED.best_time < game_progress.best_time)
                THEN EXCLUDED.best_time ELSE game_progress.best_time END,
            play_count = game_progress.play_count + 1,
            total_score = game_progress.total_score + EXCLUDED.high_score,
            last_played_at = NOW(),
            level = GREATEST(game_progress.level, COALESCE(EXCLUDED.level, game_progress.level))"#,
    )
    .bind(player_id)
    .bind(tenant_id)
    .bind(&game_id)
    .bind(body.score)
    .bind(body.time)
    .bind(body.level.unwrap_or(1))
    .execute(&mut *tx)
    .await?;

    // Calculate and update stars
    let new_high = std::cmp::max(prev_high, body.score);
    let stars = calculate_stars(&game_id, new_high);
    sqlx::query(
        "UPDATE game_progress SET stars = GREATEST(stars, $1) WHERE player_id = $2 AND tenant_id = $3 AND game_id = $4",
    )
    .bind(stars)
    .bind(player_id)
    .bind(tenant_id)
    .bind(&game_id)
    .execute(&mut *tx)
    .await?;

    // Update player totals
    sqlx::query(
        r#"UPDATE players SET
            total_score = total_score + $1,
            games_played = games_played + 1,
            total_play_time = COALESCE(total_play_time, 0) + COALESCE($2, 0)
        WHERE id = $3 AND tenant_id = $4"#,
    )
    .bind(body.score)
    .bind(body.time)
    .bind(player_id)
    .bind(tenant_id)
    .execute(&mut *tx)
    .await?;

    // Insert score history
    sqlx::query(
        "INSERT INTO score_history (player_id, tenant_id, game_id, score, level, play_time, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())",
    )
    .bind(player_id)
    .bind(tenant_id)
    .bind(&game_id)
    .bind(body.score)
    .bind(body.level)
    .bind(body.time)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    let is_new_high = body.score > prev_high;

    // Async: update leaderboard cache
    let cache = state.cache.clone();
    let tid = tenant_id.clone();
    let gid = game_id.clone();
    let pid_str = player_id.to_string();
    let shard_count = state.config.leaderboard.shard_count;
    tokio::spawn(async move {
        leaderboard::update_score(&cache, &tid, &gid, &pid_str, new_high as f64, shard_count)
            .await;
    });

    // Evaluate achievements
    let new_achievements =
        achievements::evaluate(&state.db, player_id, tenant_id).await?;

    Ok(Json(json!({
        "success": true,
        "highScore": new_high,
        "stars": stars,
        "isNewHighScore": is_new_high,
        "newAchievements": new_achievements,
    })))
}

pub async fn get_progress(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(game_id): Path<String>,
) -> AppResult<Json<Value>> {
    let row: Option<(i64, Option<i32>, i32, i32, i32)> = sqlx::query_as(
        "SELECT high_score, best_time, stars, level, play_count FROM game_progress WHERE player_id = $1 AND tenant_id = $2 AND game_id = $3",
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .bind(&game_id)
    .fetch_optional(&state.db)
    .await?;

    match row {
        Some((hs, bt, stars, level, pc)) => Ok(Json(json!({
            "gameId": game_id,
            "highScore": hs,
            "bestTime": bt,
            "stars": stars,
            "level": level,
            "playCount": pc,
        }))),
        None => Ok(Json(json!({
            "gameId": game_id,
            "highScore": 0,
            "bestTime": null,
            "stars": 0,
            "level": 1,
            "playCount": 0,
        }))),
    }
}
