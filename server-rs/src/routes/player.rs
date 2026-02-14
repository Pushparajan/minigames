use axum::{extract::State, Json};
use serde_json::{json, Value};

use crate::error::AppResult;
use crate::middleware::auth::AuthPlayer;
use crate::middleware::tenant::TenantId;
use crate::models::player::*;
use crate::AppState;

pub async fn get_profile(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let tenant_id = &tenant.0 .0;

    let p: Player = sqlx::query_as("SELECT * FROM players WHERE id = $1 AND tenant_id = $2")
        .bind(player.id)
        .bind(tenant_id)
        .fetch_one(&state.db)
        .await?;

    // Aggregate stats
    let stats: (i64, i64, i64, Option<i64>) = sqlx::query_as(
        r#"SELECT
            COUNT(*)::bigint as games_started,
            COUNT(CASE WHEN play_count > 0 THEN 1 END)::bigint as games_completed,
            COUNT(CASE WHEN stars = 3 THEN 1 END)::bigint as games_mastered,
            SUM(stars)::bigint as total_stars
        FROM game_progress WHERE player_id = $1 AND tenant_id = $2"#,
    )
    .bind(player.id)
    .bind(tenant_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "player": PlayerPublic::from(&p),
        "email": p.email,
        "isGuest": p.is_guest,
        "totalPlayTime": p.total_play_time,
        "lastLoginAt": p.last_login_at,
        "stats": {
            "gamesStarted": stats.0,
            "gamesCompleted": stats.1,
            "gamesMastered": stats.2,
            "totalStars": stats.3.unwrap_or(0),
        }
    })))
}

pub async fn update_profile(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Json(body): Json<ProfileUpdateRequest>,
) -> AppResult<Json<Value>> {
    let tenant_id = &tenant.0 .0;

    let mut updates = Vec::new();
    let mut params: Vec<String> = Vec::new();

    if let Some(ref name) = body.display_name {
        updates.push(format!("display_name = ${}", params.len() + 3));
        params.push(name.clone());
    }
    if let Some(ref avatar) = body.avatar_character {
        updates.push(format!("avatar_character = ${}", params.len() + 3));
        params.push(avatar.clone());
    }

    if updates.is_empty() {
        return Ok(Json(json!({"message": "No fields to update"})));
    }

    let sql = format!(
        "UPDATE players SET {} WHERE id = $1 AND tenant_id = $2 RETURNING id, display_name, avatar_character, total_score, games_played",
        updates.join(", ")
    );

    // Build dynamic query
    let mut query = sqlx::query_as::<_, (uuid::Uuid, String, String, i64, i32)>(&sql)
        .bind(player.id)
        .bind(tenant_id);

    for p in &params {
        query = query.bind(p);
    }

    let (id, name, avatar, score, played) = query.fetch_one(&state.db).await?;

    Ok(Json(json!({
        "player": {
            "playerId": id,
            "displayName": name,
            "avatarCharacter": avatar,
            "totalScore": score,
            "gamesPlayed": played,
        }
    })))
}

pub async fn get_all_progress(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let rows: Vec<(String, i64, Option<i32>, i32, i32, i32)> = sqlx::query_as(
        "SELECT game_id, high_score, best_time, stars, level, play_count FROM game_progress WHERE player_id = $1 AND tenant_id = $2",
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .fetch_all(&state.db)
    .await?;

    let mut progress = serde_json::Map::new();
    for (gid, hs, bt, stars, level, pc) in rows {
        progress.insert(
            gid,
            json!({
                "highScore": hs,
                "bestTime": bt,
                "stars": stars,
                "level": level,
                "playCount": pc,
            }),
        );
    }

    Ok(Json(json!({ "progress": progress })))
}

pub async fn get_achievements(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let rows: Vec<(String, Option<String>, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT pa.achievement_id, pa.game_id, pa.earned_at FROM player_achievements pa WHERE pa.player_id = $1 AND pa.tenant_id = $2",
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .fetch_all(&state.db)
    .await?;

    let achievements: Vec<Value> = rows
        .iter()
        .map(|(aid, gid, earned)| {
            json!({"achievementId": aid, "gameId": gid, "earnedAt": earned})
        })
        .collect();

    Ok(Json(json!({ "achievements": achievements })))
}
