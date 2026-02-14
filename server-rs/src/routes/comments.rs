use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthPlayer;
use crate::middleware::tenant::TenantId;
use crate::models::comment::*;
use crate::routes::leaderboards::PaginationQuery;
use crate::AppState;

pub async fn list_comments(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Path(game_id): Path<String>,
    Query(q): Query<PaginationQuery>,
) -> AppResult<Json<Value>> {
    let limit = q.limit.unwrap_or(20).min(50);
    let offset = q.offset.unwrap_or(0);

    let rows: Vec<(Uuid, Uuid, String, Option<Uuid>, String, chrono::DateTime<chrono::Utc>, Option<chrono::DateTime<chrono::Utc>>, String)> = sqlx::query_as(
        r#"SELECT c.id, c.player_id, c.game_id, c.parent_id, c.body, c.created_at, c.edited_at, p.display_name
        FROM comments c JOIN players p ON p.id = c.player_id AND p.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1 AND c.game_id = $2 AND c.status = 'published' AND c.parent_id IS NULL
        ORDER BY c.created_at DESC LIMIT $3 OFFSET $4"#,
    )
    .bind(&tenant.0 .0)
    .bind(&game_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;

    let comments: Vec<Value> = rows.iter().map(|(id, pid, gid, parent, body, created, edited, name)| {
        json!({"id": id, "playerId": pid, "gameId": gid, "parentId": parent, "body": body, "createdAt": created, "editedAt": edited, "displayName": name})
    }).collect();

    Ok(Json(json!({ "comments": comments })))
}

pub async fn get_thread(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Path((_game_id, comment_id)): Path<(String, String)>,
) -> AppResult<Json<Value>> {
    let cid = Uuid::parse_str(&comment_id)
        .map_err(|_| AppError::BadRequest("Invalid comment ID".into()))?;

    let rows: Vec<(Uuid, Uuid, String, chrono::DateTime<chrono::Utc>, String)> = sqlx::query_as(
        r#"SELECT c.id, c.player_id, c.body, c.created_at, p.display_name
        FROM comments c JOIN players p ON p.id = c.player_id AND p.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1 AND c.parent_id = $2 AND c.status = 'published'
        ORDER BY c.created_at ASC"#,
    )
    .bind(&tenant.0 .0)
    .bind(cid)
    .fetch_all(&state.db)
    .await?;

    let replies: Vec<Value> = rows.iter().map(|(id, pid, body, created, name)| {
        json!({"id": id, "playerId": pid, "body": body, "createdAt": created, "displayName": name})
    }).collect();

    Ok(Json(json!({ "replies": replies })))
}

pub async fn post_comment(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(game_id): Path<String>,
    Json(body): Json<PostCommentRequest>,
) -> AppResult<Json<Value>> {
    if body.body.is_empty() || body.body.len() > 2000 {
        return Err(AppError::BadRequest("Comment must be 1-2000 characters".into()));
    }

    let parent_id = body.parent_id
        .as_deref()
        .map(|id| Uuid::parse_str(id))
        .transpose()
        .map_err(|_| AppError::BadRequest("Invalid parent ID".into()))?;

    let id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO comments (id, player_id, tenant_id, game_id, parent_id, body, status, report_count, created_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'published', 0, NOW())
        RETURNING id"#,
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .bind(&game_id)
    .bind(parent_id)
    .bind(&body.body)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({"id": id, "status": "published"})))
}

pub async fn edit_comment(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(comment_id): Path<String>,
    Json(body): Json<EditCommentRequest>,
) -> AppResult<Json<Value>> {
    let cid = Uuid::parse_str(&comment_id)
        .map_err(|_| AppError::BadRequest("Invalid comment ID".into()))?;

    if body.body.is_empty() || body.body.len() > 2000 {
        return Err(AppError::BadRequest("Comment must be 1-2000 characters".into()));
    }

    let result = sqlx::query(
        "UPDATE comments SET body = $1, edited_at = NOW() WHERE id = $2 AND player_id = $3 AND tenant_id = $4",
    )
    .bind(&body.body)
    .bind(cid)
    .bind(player.id)
    .bind(&tenant.0 .0)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Comment not found or not yours".into()));
    }

    Ok(Json(json!({"success": true})))
}

pub async fn delete_comment(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(comment_id): Path<String>,
) -> AppResult<Json<Value>> {
    let cid = Uuid::parse_str(&comment_id)
        .map_err(|_| AppError::BadRequest("Invalid comment ID".into()))?;

    sqlx::query(
        "UPDATE comments SET status = 'removed' WHERE id = $1 AND player_id = $2 AND tenant_id = $3",
    )
    .bind(cid)
    .bind(player.id)
    .bind(&tenant.0 .0)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({"success": true})))
}

pub async fn report_comment(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(comment_id): Path<String>,
    Json(body): Json<ReportRequest>,
) -> AppResult<Json<Value>> {
    let cid = Uuid::parse_str(&comment_id)
        .map_err(|_| AppError::BadRequest("Invalid comment ID".into()))?;

    sqlx::query(
        r#"INSERT INTO content_reports (reporter_id, tenant_id, content_type, content_id, reason, description, status, created_at)
        VALUES ($1, $2, 'comment', $3, $4, $5, 'open', NOW())"#,
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .bind(cid)
    .bind(&body.reason)
    .bind(&body.description)
    .execute(&state.db)
    .await?;

    sqlx::query("UPDATE comments SET report_count = report_count + 1 WHERE id = $1")
        .bind(cid)
        .execute(&state.db)
        .await?;

    Ok(Json(json!({"success": true})))
}

// Reviews

pub async fn list_reviews(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Path(game_id): Path<String>,
    Query(q): Query<PaginationQuery>,
) -> AppResult<Json<Value>> {
    let limit = q.limit.unwrap_or(20).min(50);
    let offset = q.offset.unwrap_or(0);

    let rows: Vec<(Uuid, Uuid, i32, Option<String>, Option<String>, chrono::DateTime<chrono::Utc>, String)> = sqlx::query_as(
        r#"SELECT r.id, r.player_id, r.rating, r.title, r.body, r.created_at, p.display_name
        FROM game_reviews r JOIN players p ON p.id = r.player_id AND p.tenant_id = r.tenant_id
        WHERE r.tenant_id = $1 AND r.game_id = $2 AND r.status = 'published'
        ORDER BY r.created_at DESC LIMIT $3 OFFSET $4"#,
    )
    .bind(&tenant.0 .0)
    .bind(&game_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;

    // Rating distribution
    let dist: Vec<(i32, i64)> = sqlx::query_as(
        "SELECT rating, COUNT(*)::bigint FROM game_reviews WHERE tenant_id = $1 AND game_id = $2 AND status = 'published' GROUP BY rating",
    )
    .bind(&tenant.0 .0)
    .bind(&game_id)
    .fetch_all(&state.db)
    .await?;

    let reviews: Vec<Value> = rows.iter().map(|(id, pid, rating, title, body, created, name)| {
        json!({"id": id, "playerId": pid, "rating": rating, "title": title, "body": body, "createdAt": created, "displayName": name})
    }).collect();

    let mut distribution = json!({"1": 0, "2": 0, "3": 0, "4": 0, "5": 0});
    for (r, c) in &dist {
        distribution[r.to_string()] = json!(c);
    }

    Ok(Json(json!({ "reviews": reviews, "distribution": distribution })))
}

pub async fn post_review(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(game_id): Path<String>,
    Json(body): Json<PostReviewRequest>,
) -> AppResult<Json<Value>> {
    if body.rating < 1 || body.rating > 5 {
        return Err(AppError::BadRequest("Rating must be 1-5".into()));
    }

    let id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO game_reviews (id, player_id, tenant_id, game_id, rating, title, body, status, created_at, updated_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'published', NOW(), NOW())
        ON CONFLICT (player_id, tenant_id, game_id) DO UPDATE SET
            rating = EXCLUDED.rating, title = EXCLUDED.title, body = EXCLUDED.body, updated_at = NOW()
        RETURNING id"#,
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .bind(&game_id)
    .bind(body.rating)
    .bind(&body.title)
    .bind(&body.body)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({"id": id, "status": "published"})))
}

pub async fn delete_review(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(game_id): Path<String>,
) -> AppResult<Json<Value>> {
    sqlx::query(
        "UPDATE game_reviews SET status = 'removed' WHERE player_id = $1 AND tenant_id = $2 AND game_id = $3",
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .bind(&game_id)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({"success": true})))
}

pub async fn report_review(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(review_id): Path<String>,
    Json(body): Json<ReportRequest>,
) -> AppResult<Json<Value>> {
    let rid = Uuid::parse_str(&review_id)
        .map_err(|_| AppError::BadRequest("Invalid review ID".into()))?;

    sqlx::query(
        r#"INSERT INTO content_reports (reporter_id, tenant_id, content_type, content_id, reason, description, status, created_at)
        VALUES ($1, $2, 'review', $3, $4, $5, 'open', NOW())"#,
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .bind(rid)
    .bind(&body.reason)
    .bind(&body.description)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({"success": true})))
}
