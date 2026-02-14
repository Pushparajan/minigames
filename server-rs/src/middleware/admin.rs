use axum::{
    extract::{Request, State},
    middleware::Next,
    response::Response,
};
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::auth::AuthPlayer;
use crate::AppState;

fn role_level(role: &str) -> i32 {
    match role {
        "moderator" => 1,
        "admin" => 2,
        "super_admin" => 3,
        _ => 0,
    }
}

async fn check_admin_role(
    state: &AppState,
    player_id: Uuid,
    tenant_id: &str,
    min_role: &str,
) -> Result<String, AppError> {
    let row = sqlx::query_scalar::<_, Option<String>>(
        "SELECT admin_role FROM players WHERE id = $1 AND tenant_id = $2",
    )
    .bind(player_id)
    .bind(tenant_id)
    .fetch_optional(&state.db)
    .await?
    .flatten();

    let actual_role = row.unwrap_or_default();
    if actual_role.is_empty() || role_level(&actual_role) < role_level(min_role) {
        return Err(AppError::Forbidden(format!(
            "Requires {} role or higher",
            min_role
        )));
    }
    Ok(actual_role)
}

/// Middleware factory: requires minimum admin role.
/// Use via `axum::middleware::from_fn_with_state(state, require_moderator)` etc.
pub async fn require_moderator(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let player = req
        .extensions()
        .get::<AuthPlayer>()
        .cloned()
        .ok_or_else(|| AppError::Unauthorized("Authentication required".into()))?;

    let role = check_admin_role(&state, player.id, &player.tenant_id, "moderator").await?;
    req.extensions_mut().insert(AuthPlayer {
        id: player.id,
        tenant_id: player.tenant_id,
        role: Some(role),
    });

    Ok(next.run(req).await)
}

pub async fn require_admin(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let player = req
        .extensions()
        .get::<AuthPlayer>()
        .cloned()
        .ok_or_else(|| AppError::Unauthorized("Authentication required".into()))?;

    let role = check_admin_role(&state, player.id, &player.tenant_id, "admin").await?;
    req.extensions_mut().insert(AuthPlayer {
        id: player.id,
        tenant_id: player.tenant_id,
        role: Some(role),
    });

    Ok(next.run(req).await)
}

pub async fn require_super_admin(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let player = req
        .extensions()
        .get::<AuthPlayer>()
        .cloned()
        .ok_or_else(|| AppError::Unauthorized("Authentication required".into()))?;

    let role = check_admin_role(&state, player.id, &player.tenant_id, "super_admin").await?;
    req.extensions_mut().insert(AuthPlayer {
        id: player.id,
        tenant_id: player.tenant_id,
        role: Some(role),
    });

    Ok(next.run(req).await)
}
