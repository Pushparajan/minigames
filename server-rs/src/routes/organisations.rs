use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthPlayer;
use crate::middleware::entitlements;
use crate::middleware::tenant::TenantId;
use crate::models::organisation::*;
use crate::services::subscription_sync;
use crate::AppState;

pub async fn create_org(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Json(body): Json<CreateOrgRequest>,
) -> AppResult<Json<Value>> {
    let tenant_id = &tenant.0 .0;

    if body.name.is_empty() {
        return Err(AppError::BadRequest("Organisation name required".into()));
    }

    // Check how many orgs the player already owns
    let owned: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM organisations WHERE owner_id = $1 AND tenant_id = $2",
    )
    .bind(player.id)
    .bind(tenant_id)
    .fetch_one(&state.db)
    .await?;

    if owned >= 1 {
        // Check entitlement for more
        let _ = entitlements::require_entitlement_check(
            &state.db, &state.cache, player.id, tenant_id, "organisations",
        )
        .await;
    }

    let slug = body.slug.unwrap_or_else(|| {
        body.name
            .to_lowercase()
            .replace(|c: char| !c.is_alphanumeric(), "-")
    });
    let org_id = Uuid::new_v4().to_string();

    let mut tx = state.db.begin().await?;

    sqlx::query(
        "INSERT INTO organisations (id, tenant_id, name, slug, owner_id, created_at) VALUES ($1, $2, $3, $4, $5, NOW())",
    )
    .bind(&org_id)
    .bind(tenant_id)
    .bind(&body.name)
    .bind(&slug)
    .bind(player.id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO organisation_members (organisation_id, player_id, tenant_id, role, joined_at) VALUES ($1, $2, $3, 'owner', NOW())",
    )
    .bind(&org_id)
    .bind(player.id)
    .bind(tenant_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    // Provision free entitlements
    subscription_sync::provision_entitlements(&state.db, &org_id, "", tenant_id, "free").await?;

    Ok(Json(json!({
        "id": org_id, "name": body.name, "slug": slug, "role": "owner"
    })))
}

pub async fn list_orgs(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let rows: Vec<(String, String, String, String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        r#"SELECT o.id, o.name, o.slug, om.role, om.joined_at
        FROM organisations o
        JOIN organisation_members om ON om.organisation_id = o.id AND om.tenant_id = o.tenant_id
        WHERE om.player_id = $1 AND om.tenant_id = $2
        ORDER BY om.joined_at"#,
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .fetch_all(&state.db)
    .await?;

    let orgs: Vec<Value> = rows.iter().map(|(id, name, slug, role, joined)| {
        json!({"id": id, "name": name, "slug": slug, "role": role, "joinedAt": joined})
    }).collect();

    Ok(Json(json!({ "organisations": orgs })))
}

pub async fn get_org(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    let tid = &tenant.0 .0;

    let org: Option<(String, String, String, Uuid, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT id, name, slug, owner_id, created_at FROM organisations WHERE id = $1 AND tenant_id = $2",
    )
    .bind(&id)
    .bind(tid)
    .fetch_optional(&state.db)
    .await?;

    let org = org.ok_or_else(|| AppError::NotFound("Organisation not found".into()))?;

    let member_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM organisation_members WHERE organisation_id = $1 AND tenant_id = $2",
    )
    .bind(&id)
    .bind(tid)
    .fetch_one(&state.db)
    .await?;

    let plan = subscription_sync::get_effective_plan(&state.db, &id).await?;

    Ok(Json(json!({
        "id": org.0, "name": org.1, "slug": org.2, "ownerId": org.3,
        "createdAt": org.4, "memberCount": member_count, "plan": plan,
    })))
}

pub async fn add_member(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Path(id): Path<String>,
    Json(body): Json<AddMemberRequest>,
) -> AppResult<Json<Value>> {
    let tenant_id = &tenant.0 .0;

    // Check caller is owner or admin of org
    let role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM organisation_members WHERE organisation_id = $1 AND player_id = $2 AND tenant_id = $3",
    )
    .bind(&id)
    .bind(player.id)
    .bind(tenant_id)
    .fetch_optional(&state.db)
    .await?;

    match role.as_deref() {
        Some("owner") | Some("admin") => {}
        _ => return Err(AppError::Forbidden("Must be org owner or admin".into())),
    }

    // Check member limit
    let limit = entitlements::get_limit(&state.db, &state.cache, &id, tenant_id, "max_members").await?;
    let current = entitlements::get_current_usage(&state.db, &id, tenant_id, "max_members").await?;
    if let Some(l) = limit {
        if current >= l {
            return Err(AppError::Forbidden("Member limit reached for your plan".into()));
        }
    }

    let new_player_id = Uuid::parse_str(&body.player_id)
        .map_err(|_| AppError::BadRequest("Invalid player ID".into()))?;
    let member_role = body.role.as_deref().unwrap_or("member");

    sqlx::query(
        "INSERT INTO organisation_members (organisation_id, player_id, tenant_id, role, joined_at) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT DO NOTHING",
    )
    .bind(&id)
    .bind(new_player_id)
    .bind(tenant_id)
    .bind(member_role)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({"success": true})))
}
