use axum::{
    extract::{Request, State},
    http::header,
    middleware::Next,
    response::Response,
};
use chrono::Utc;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String, // player_id
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
    pub role: Option<String>,
    #[serde(rename = "type")]
    pub token_type: Option<String>, // "access" or "refresh"
    pub exp: i64,
    pub iat: i64,
}

#[derive(Debug, Clone)]
pub struct AuthPlayer {
    pub id: Uuid,
    pub tenant_id: String,
    pub role: Option<String>,
}

pub fn generate_tokens(
    player_id: Uuid,
    tenant_id: &str,
    role: Option<&str>,
    secret: &str,
    access_expiry_secs: i64,
    refresh_expiry_secs: i64,
) -> AppResult<(String, String)> {
    let now = Utc::now().timestamp();

    let access_claims = Claims {
        sub: player_id.to_string(),
        tenant_id: tenant_id.to_string(),
        role: role.map(String::from),
        token_type: Some("access".to_string()),
        exp: now + access_expiry_secs,
        iat: now,
    };
    let access_token = encode(
        &Header::default(),
        &access_claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?;

    let refresh_claims = Claims {
        sub: player_id.to_string(),
        tenant_id: tenant_id.to_string(),
        role: role.map(String::from),
        token_type: Some("refresh".to_string()),
        exp: now + refresh_expiry_secs,
        iat: now,
    };
    let refresh_token = encode(
        &Header::default(),
        &refresh_claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?;

    Ok((access_token, refresh_token))
}

pub fn verify_token(token: &str, secret: &str) -> AppResult<Claims> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )?;
    Ok(data.claims)
}

fn extract_bearer(req: &Request) -> Option<String> {
    req.headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(String::from)
}

/// Middleware: requires valid JWT. Sets AuthPlayer in extensions.
pub async fn authenticate(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let token = extract_bearer(&req)
        .ok_or_else(|| AppError::Unauthorized("No token provided".into()))?;

    let claims = verify_token(&token, &state.config.jwt.secret)?;

    if claims.token_type.as_deref() == Some("refresh") {
        return Err(AppError::Unauthorized(
            "Access token required".into(),
        ));
    }

    let player_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| AppError::Unauthorized("Invalid token subject".into()))?;

    req.extensions_mut().insert(AuthPlayer {
        id: player_id,
        tenant_id: claims.tenant_id,
        role: claims.role,
    });

    Ok(next.run(req).await)
}

/// Middleware: optionally sets AuthPlayer if token present but doesn't require it.
pub async fn optional_auth(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    if let Some(token) = extract_bearer(&req) {
        if let Ok(claims) = verify_token(&token, &state.config.jwt.secret) {
            if claims.token_type.as_deref() != Some("refresh") {
                if let Ok(player_id) = Uuid::parse_str(&claims.sub) {
                    req.extensions_mut().insert(AuthPlayer {
                        id: player_id,
                        tenant_id: claims.tenant_id,
                        role: claims.role,
                    });
                }
            }
        }
    }
    Ok(next.run(req).await)
}
