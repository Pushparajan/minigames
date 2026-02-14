use axum::{
    extract::{Request, State},
    middleware::Next,
    response::Response,
};

use crate::error::AppError;
use crate::AppState;

#[derive(Debug, Clone)]
pub struct TenantId(pub String);

/// Middleware: resolves tenant from x-api-key header or uses default.
pub async fn resolve_tenant(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let tenant_id = req
        .headers()
        .get(&state.config.tenant.api_key_header)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| {
            // Format: tenant_{id}_{secret}
            let parts: Vec<&str> = v.splitn(3, '_').collect();
            if parts.len() >= 2 && parts[0] == "tenant" {
                Some(parts[1].to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| state.config.tenant.default_tenant_id.clone());

    req.extensions_mut().insert(TenantId(tenant_id));
    Ok(next.run(req).await)
}
