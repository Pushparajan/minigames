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
use crate::models::comment::*;
use crate::AppState;

#[derive(Deserialize)]
pub struct AdminQuery {
    pub page: Option<i64>,
    pub limit: Option<i64>,
    pub status: Option<String>,
    pub search: Option<String>,
}

pub async fn stats(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let tid = &tenant.0 .0;
    let comments: i64 = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM comments WHERE tenant_id = $1").bind(tid).fetch_one(&state.db).await?;
    let reviews: i64 = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM game_reviews WHERE tenant_id = $1").bind(tid).fetch_one(&state.db).await?;
    let reports: i64 = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM content_reports WHERE tenant_id = $1 AND status = 'open'").bind(tid).fetch_one(&state.db).await?;
    let players: i64 = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM players WHERE tenant_id = $1").bind(tid).fetch_one(&state.db).await?;
    let flagged: i64 = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM comments WHERE tenant_id = $1 AND report_count > 0 AND status = 'published'").bind(tid).fetch_one(&state.db).await?;

    Ok(Json(json!({
        "comments": comments, "reviews": reviews, "openReports": reports,
        "players": players, "flaggedContent": flagged,
    })))
}

pub async fn moderation_queue(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Query(q): Query<AdminQuery>,
) -> AppResult<Json<Value>> {
    let limit = q.limit.unwrap_or(50).min(100);
    let offset = q.page.unwrap_or(0) * limit;

    let rows: Vec<(Uuid, String, String, i32, chrono::DateTime<chrono::Utc>, String)> = sqlx::query_as(
        r#"SELECT c.id, c.body, c.game_id, c.report_count, c.created_at, p.display_name
        FROM comments c JOIN players p ON p.id = c.player_id AND p.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1 AND c.report_count > 0 AND c.status = 'published'
        ORDER BY c.report_count DESC LIMIT $2 OFFSET $3"#,
    )
    .bind(&tenant.0 .0)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;

    let items: Vec<Value> = rows.iter().map(|(id, body, gid, reports, created, name)| {
        json!({"id": id, "body": body, "gameId": gid, "reportCount": reports, "createdAt": created, "displayName": name, "type": "comment"})
    }).collect();

    Ok(Json(json!({ "queue": items })))
}

pub async fn list_reports(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Query(q): Query<AdminQuery>,
) -> AppResult<Json<Value>> {
    let limit = q.limit.unwrap_or(50).min(100);
    let offset = q.page.unwrap_or(0) * limit;
    let status_filter = q.status.as_deref().unwrap_or("open");

    let rows: Vec<(Uuid, Uuid, String, Uuid, String, Option<String>, String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        r#"SELECT cr.id, cr.reporter_id, cr.content_type, cr.content_id, cr.reason, cr.description, cr.status, cr.created_at
        FROM content_reports cr
        WHERE cr.tenant_id = $1 AND cr.status = $2
        ORDER BY cr.created_at DESC LIMIT $3 OFFSET $4"#,
    )
    .bind(&tenant.0 .0)
    .bind(status_filter)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;

    let reports: Vec<Value> = rows.iter().map(|(id, reporter, ct, cid, reason, desc, status, created)| {
        json!({"id": id, "reporterId": reporter, "contentType": ct, "contentId": cid, "reason": reason, "description": desc, "status": status, "createdAt": created})
    }).collect();

    Ok(Json(json!({ "reports": reports })))
}

async fn moderate_content(
    state: &AppState,
    admin_id: Uuid,
    tenant_id: &str,
    content_type: &str,
    content_id: &str,
    action: &str,
    new_status: &str,
) -> AppResult<()> {
    let cid = Uuid::parse_str(content_id)
        .map_err(|_| AppError::BadRequest("Invalid content ID".into()))?;

    match content_type {
        "comment" | "comments" => {
            sqlx::query("UPDATE comments SET status = $1, moderated_by = $2 WHERE id = $3 AND tenant_id = $4")
                .bind(new_status).bind(admin_id).bind(cid).bind(tenant_id)
                .execute(&state.db).await?;
        }
        "review" | "reviews" => {
            sqlx::query("UPDATE game_reviews SET status = $1 WHERE id = $2 AND tenant_id = $3")
                .bind(new_status).bind(cid).bind(tenant_id)
                .execute(&state.db).await?;
        }
        _ => {}
    }

    sqlx::query(
        "INSERT INTO moderation_log (admin_id, tenant_id, action, content_type, content_id, created_at) VALUES ($1, $2, $3, $4, $5, NOW())",
    )
    .bind(admin_id)
    .bind(tenant_id)
    .bind(action)
    .bind(content_type)
    .bind(content_id)
    .execute(&state.db)
    .await?;

    Ok(())
}

pub async fn approve_comment(State(state): State<AppState>, player: axum::Extension<AuthPlayer>, tenant: axum::Extension<TenantId>, Path(id): Path<String>) -> AppResult<Json<Value>> {
    moderate_content(&state, player.id, &tenant.0 .0, "comment", &id, "approve", "published").await?;
    Ok(Json(json!({"success": true})))
}
pub async fn hide_comment(State(state): State<AppState>, player: axum::Extension<AuthPlayer>, tenant: axum::Extension<TenantId>, Path(id): Path<String>) -> AppResult<Json<Value>> {
    moderate_content(&state, player.id, &tenant.0 .0, "comment", &id, "hide", "hidden").await?;
    Ok(Json(json!({"success": true})))
}
pub async fn remove_comment(State(state): State<AppState>, player: axum::Extension<AuthPlayer>, tenant: axum::Extension<TenantId>, Path(id): Path<String>) -> AppResult<Json<Value>> {
    moderate_content(&state, player.id, &tenant.0 .0, "comment", &id, "remove", "removed").await?;
    Ok(Json(json!({"success": true})))
}
pub async fn restore_comment(State(state): State<AppState>, player: axum::Extension<AuthPlayer>, tenant: axum::Extension<TenantId>, Path(id): Path<String>) -> AppResult<Json<Value>> {
    moderate_content(&state, player.id, &tenant.0 .0, "comment", &id, "restore", "published").await?;
    Ok(Json(json!({"success": true})))
}
pub async fn approve_review(State(state): State<AppState>, player: axum::Extension<AuthPlayer>, tenant: axum::Extension<TenantId>, Path(id): Path<String>) -> AppResult<Json<Value>> {
    moderate_content(&state, player.id, &tenant.0 .0, "review", &id, "approve", "published").await?;
    Ok(Json(json!({"success": true})))
}
pub async fn hide_review(State(state): State<AppState>, player: axum::Extension<AuthPlayer>, tenant: axum::Extension<TenantId>, Path(id): Path<String>) -> AppResult<Json<Value>> {
    moderate_content(&state, player.id, &tenant.0 .0, "review", &id, "hide", "hidden").await?;
    Ok(Json(json!({"success": true})))
}
pub async fn remove_review(State(state): State<AppState>, player: axum::Extension<AuthPlayer>, tenant: axum::Extension<TenantId>, Path(id): Path<String>) -> AppResult<Json<Value>> {
    moderate_content(&state, player.id, &tenant.0 .0, "review", &id, "remove", "removed").await?;
    Ok(Json(json!({"success": true})))
}

pub async fn resolve_report(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(id): Path<String>,
    Json(body): Json<ResolveReportRequest>,
) -> AppResult<Json<Value>> {
    let rid = Uuid::parse_str(&id).map_err(|_| AppError::BadRequest("Invalid report ID".into()))?;
    sqlx::query("UPDATE content_reports SET status = 'resolved', resolved_by = $1, resolution_note = $2 WHERE id = $3 AND tenant_id = $4")
        .bind(player.id).bind(&body.note).bind(rid).bind(&tenant.0 .0)
        .execute(&state.db).await?;
    sqlx::query("INSERT INTO moderation_log (admin_id, tenant_id, action, content_type, content_id, created_at) VALUES ($1, $2, 'resolve_report', 'report', $3, NOW())")
        .bind(player.id).bind(&tenant.0 .0).bind(&id)
        .execute(&state.db).await?;
    Ok(Json(json!({"success": true})))
}

pub async fn dismiss_report(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    let rid = Uuid::parse_str(&id).map_err(|_| AppError::BadRequest("Invalid report ID".into()))?;
    sqlx::query("UPDATE content_reports SET status = 'dismissed', resolved_by = $1 WHERE id = $2 AND tenant_id = $3")
        .bind(player.id).bind(rid).bind(&tenant.0 .0)
        .execute(&state.db).await?;
    Ok(Json(json!({"success": true})))
}

pub async fn search_users(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Query(q): Query<AdminQuery>,
) -> AppResult<Json<Value>> {
    let limit = q.limit.unwrap_or(20).min(50);
    let offset = q.page.unwrap_or(0) * limit;
    let search = format!("%{}%", q.search.as_deref().unwrap_or(""));

    let rows: Vec<(Uuid, String, Option<String>, i64, i32, Option<String>, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        r#"SELECT id, display_name, email, total_score, games_played, admin_role, created_at
        FROM players WHERE tenant_id = $1 AND (display_name ILIKE $2 OR email ILIKE $2)
        ORDER BY created_at DESC LIMIT $3 OFFSET $4"#,
    )
    .bind(&tenant.0 .0).bind(&search).bind(limit).bind(offset)
    .fetch_all(&state.db).await?;

    let users: Vec<Value> = rows.iter().map(|(id, name, email, score, played, role, created)| {
        json!({"id": id, "displayName": name, "email": email, "totalScore": score, "gamesPlayed": played, "adminRole": role, "createdAt": created})
    }).collect();

    Ok(Json(json!({ "users": users })))
}

pub async fn get_user_detail(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    let uid = Uuid::parse_str(&id).map_err(|_| AppError::BadRequest("Invalid user ID".into()))?;
    let tid = &tenant.0 .0;

    let player: Option<(Uuid, String, Option<String>, i64, i32, Option<String>, bool)> = sqlx::query_as(
        "SELECT id, display_name, email, total_score, games_played, admin_role, is_guest FROM players WHERE id = $1 AND tenant_id = $2",
    ).bind(uid).bind(tid).fetch_optional(&state.db).await?;

    let player = player.ok_or_else(|| AppError::NotFound("Player not found".into()))?;

    let comments_count: i64 = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM comments WHERE player_id = $1 AND tenant_id = $2").bind(uid).bind(tid).fetch_one(&state.db).await?;
    let reviews_count: i64 = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM game_reviews WHERE player_id = $1 AND tenant_id = $2").bind(uid).bind(tid).fetch_one(&state.db).await?;
    let reports_count: i64 = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM content_reports WHERE reporter_id = $1 AND tenant_id = $2").bind(uid).bind(tid).fetch_one(&state.db).await?;

    Ok(Json(json!({
        "id": player.0, "displayName": player.1, "email": player.2,
        "totalScore": player.3, "gamesPlayed": player.4, "adminRole": player.5, "isGuest": player.6,
        "counts": {"comments": comments_count, "reviews": reviews_count, "reports": reports_count}
    })))
}

pub async fn warn_user(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(id): Path<String>,
    Json(body): Json<WarnRequest>,
) -> AppResult<Json<Value>> {
    let uid = Uuid::parse_str(&id).map_err(|_| AppError::BadRequest("Invalid user ID".into()))?;
    sqlx::query("INSERT INTO moderation_log (admin_id, tenant_id, action, content_type, target_player_id, reason, created_at) VALUES ($1, $2, 'warn_user', 'player', $3, $4, NOW())")
        .bind(player.id).bind(&tenant.0 .0).bind(uid).bind(&body.reason)
        .execute(&state.db).await?;
    Ok(Json(json!({"success": true})))
}

pub async fn ban_user(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    let uid = Uuid::parse_str(&id).map_err(|_| AppError::BadRequest("Invalid user ID".into()))?;
    let tid = &tenant.0 .0;

    sqlx::query("UPDATE comments SET status = 'hidden' WHERE player_id = $1 AND tenant_id = $2").bind(uid).bind(tid).execute(&state.db).await?;
    sqlx::query("UPDATE game_reviews SET status = 'hidden' WHERE player_id = $1 AND tenant_id = $2").bind(uid).bind(tid).execute(&state.db).await?;
    sqlx::query("INSERT INTO moderation_log (admin_id, tenant_id, action, content_type, target_player_id, created_at) VALUES ($1, $2, 'ban_user', 'player', $3, NOW())")
        .bind(player.id).bind(tid).bind(uid)
        .execute(&state.db).await?;
    Ok(Json(json!({"success": true})))
}

pub async fn set_role(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(id): Path<String>,
    Json(body): Json<SetRoleRequest>,
) -> AppResult<Json<Value>> {
    let uid = Uuid::parse_str(&id).map_err(|_| AppError::BadRequest("Invalid user ID".into()))?;
    sqlx::query("UPDATE players SET admin_role = $1 WHERE id = $2 AND tenant_id = $3")
        .bind(&body.role).bind(uid).bind(&tenant.0 .0)
        .execute(&state.db).await?;
    sqlx::query("INSERT INTO moderation_log (admin_id, tenant_id, action, content_type, target_player_id, metadata, created_at) VALUES ($1, $2, 'set_role', 'player', $3, $4, NOW())")
        .bind(player.id).bind(&tenant.0 .0).bind(uid).bind(json!({"role": body.role}))
        .execute(&state.db).await?;
    Ok(Json(json!({"success": true})))
}

pub async fn moderation_log(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Query(q): Query<AdminQuery>,
) -> AppResult<Json<Value>> {
    let limit = q.limit.unwrap_or(50).min(100);
    let offset = q.page.unwrap_or(0) * limit;

    let rows: Vec<(Uuid, String, Option<String>, Option<String>, Option<Uuid>, chrono::DateTime<chrono::Utc>, String)> = sqlx::query_as(
        r#"SELECT ml.admin_id, ml.action, ml.content_type, ml.content_id, ml.target_player_id, ml.created_at, p.display_name
        FROM moderation_log ml JOIN players p ON p.id = ml.admin_id AND p.tenant_id = ml.tenant_id
        WHERE ml.tenant_id = $1 ORDER BY ml.created_at DESC LIMIT $2 OFFSET $3"#,
    )
    .bind(&tenant.0 .0).bind(limit).bind(offset)
    .fetch_all(&state.db).await?;

    let entries: Vec<Value> = rows.iter().map(|(aid, action, ct, cid, target, created, name)| {
        json!({"adminId": aid, "adminName": name, "action": action, "contentType": ct, "contentId": cid, "targetPlayerId": target, "createdAt": created})
    }).collect();

    Ok(Json(json!({ "log": entries })))
}
