use axum::{extract::State, Json};
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthPlayer;
use crate::middleware::tenant::TenantId;
use crate::models::compliance::BatchSyncRequest;
use crate::AppState;

pub async fn batch_sync(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Json(body): Json<BatchSyncRequest>,
) -> AppResult<Json<Value>> {
    let player_id = player.id;
    let tenant_id = &tenant.0 .0;

    if body.operations.len() > 50 {
        return Err(AppError::BadRequest(
            "Maximum 50 operations per batch".into(),
        ));
    }

    let mut processed = Vec::new();
    let mut ops = body.operations;
    ops.sort_by_key(|op| op.timestamp.unwrap_or(0));

    for op in &ops {
        let op_id = op
            .id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        match op.action.as_str() {
            "score_submit" => {
                if let Some(ref game_id) = op.game_id {
                    let score = op.score.unwrap_or(0);
                    sqlx::query(
                        r#"INSERT INTO game_progress (player_id, tenant_id, game_id, high_score, play_count, total_score, stars, level, last_played_at)
                        VALUES ($1, $2, $3, $4, 1, $4, 0, $5, NOW())
                        ON CONFLICT (player_id, tenant_id, game_id) DO UPDATE SET
                            high_score = GREATEST(game_progress.high_score, EXCLUDED.high_score),
                            play_count = game_progress.play_count + 1,
                            total_score = game_progress.total_score + EXCLUDED.high_score,
                            stars = GREATEST(game_progress.stars, $6),
                            last_played_at = NOW()"#,
                    )
                    .bind(player_id)
                    .bind(tenant_id)
                    .bind(game_id)
                    .bind(score)
                    .bind(op.level.unwrap_or(1))
                    .bind(op.stars.unwrap_or(0))
                    .execute(&state.db)
                    .await?;
                }
            }
            "player_update" => {
                if let Some(ref player_data) = op.player {
                    if let Some(name) = player_data.get("displayName").and_then(|v| v.as_str()) {
                        sqlx::query(
                            "UPDATE players SET display_name = $1 WHERE id = $2 AND tenant_id = $3",
                        )
                        .bind(name)
                        .bind(player_id)
                        .bind(tenant_id)
                        .execute(&state.db)
                        .await?;
                    }
                }
            }
            "settings_update" => {
                if let Some(ref settings) = op.settings {
                    sqlx::query(
                        r#"INSERT INTO player_settings (player_id, tenant_id, settings_json, updated_at)
                        VALUES ($1, $2, $3, NOW())
                        ON CONFLICT (player_id, tenant_id) DO UPDATE SET
                            settings_json = player_settings.settings_json || EXCLUDED.settings_json,
                            updated_at = NOW()"#,
                    )
                    .bind(player_id)
                    .bind(tenant_id)
                    .bind(settings)
                    .execute(&state.db)
                    .await?;
                }
            }
            "custom_data" => {
                if let (Some(ref game_id), Some(ref data)) = (&op.game_id, &op.custom_data) {
                    sqlx::query(
                        r#"UPDATE game_progress SET custom_data = COALESCE(custom_data, '{}'::jsonb) || $1
                        WHERE player_id = $2 AND tenant_id = $3 AND game_id = $4"#,
                    )
                    .bind(data)
                    .bind(player_id)
                    .bind(tenant_id)
                    .bind(game_id)
                    .execute(&state.db)
                    .await?;
                }
            }
            _ => {}
        }
        processed.push(op_id);
    }

    Ok(Json(json!({
        "processed": processed,
        "count": processed.len(),
    })))
}
