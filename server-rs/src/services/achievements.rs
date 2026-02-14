use uuid::Uuid;

use crate::error::AppResult;

pub async fn evaluate(
    db: &sqlx::PgPool,
    player_id: Uuid,
    tenant_id: &str,
) -> AppResult<Vec<String>> {
    // Fetch player stats
    let player_stats: Option<(i64, i32)> = sqlx::query_as(
        "SELECT total_score, games_played FROM players WHERE id = $1 AND tenant_id = $2",
    )
    .bind(player_id)
    .bind(tenant_id)
    .fetch_optional(db)
    .await?;

    let (total_score, games_played) = match player_stats {
        Some(s) => s,
        None => return Ok(vec![]),
    };

    // Fetch progress aggregates
    let unique_games: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT game_id)::bigint FROM game_progress WHERE player_id = $1 AND tenant_id = $2",
    )
    .bind(player_id)
    .bind(tenant_id)
    .fetch_one(db)
    .await?;

    let three_star_games: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM game_progress WHERE player_id = $1 AND tenant_id = $2 AND stars = 3",
    )
    .bind(player_id)
    .bind(tenant_id)
    .fetch_one(db)
    .await?;

    // Fetch achievement definitions
    let achievements: Vec<(String, serde_json::Value, Option<String>)> = sqlx::query_as(
        "SELECT id, criteria_json, game_id FROM achievements WHERE tenant_id = $1",
    )
    .bind(tenant_id)
    .fetch_all(db)
    .await?;

    // Fetch already-earned
    let earned: Vec<String> = sqlx::query_scalar(
        "SELECT achievement_id FROM player_achievements WHERE player_id = $1 AND tenant_id = $2",
    )
    .bind(player_id)
    .bind(tenant_id)
    .fetch_all(db)
    .await?;

    let mut newly_awarded = Vec::new();

    for (id, criteria, _game_id) in &achievements {
        if earned.contains(id) {
            continue;
        }

        let criteria_type = criteria
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let threshold = criteria
            .get("threshold")
            .and_then(|v| v.as_i64())
            .unwrap_or(i64::MAX);

        let met = match criteria_type {
            "games_played" => (games_played as i64) >= threshold,
            "total_score" => total_score >= threshold,
            "unique_games" => unique_games >= threshold,
            "all_three_stars" => three_star_games >= threshold,
            _ => false,
        };

        if met {
            sqlx::query(
                "INSERT INTO player_achievements (player_id, tenant_id, achievement_id, game_id, earned_at) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT DO NOTHING",
            )
            .bind(player_id)
            .bind(tenant_id)
            .bind(id)
            .bind(_game_id.as_deref())
            .execute(db)
            .await?;

            newly_awarded.push(id.clone());
        }
    }

    Ok(newly_awarded)
}
