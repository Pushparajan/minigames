use axum::{extract::State, Json};
use serde_json::{json, Value};

use crate::AppState;

pub async fn health(State(state): State<AppState>) -> Json<Value> {
    let db_ok = sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.db)
        .await
        .is_ok();
    let redis_ok = state.cache.health_check().await;

    let status = if db_ok && redis_ok { "healthy" } else { "degraded" };
    Json(json!({
        "status": status,
        "postgres": db_ok,
        "redis": redis_ok,
        "timestamp": chrono::Utc::now(),
    }))
}

pub async fn metrics(State(state): State<AppState>) -> Json<Value> {
    let db_ok = sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.db)
        .await
        .is_ok();
    let redis_ok = state.cache.health_check().await;

    Json(json!({
        "uptime": "running",
        "postgres": db_ok,
        "redis": redis_ok,
    }))
}
