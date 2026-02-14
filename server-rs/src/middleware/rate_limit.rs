use axum::{
    extract::{ConnectInfo, Request, State},
    middleware::Next,
    response::Response,
};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::error::AppError;
use crate::middleware::auth::AuthPlayer;
use crate::AppState;

#[derive(Clone)]
pub struct RateLimiter {
    windows: Arc<Mutex<HashMap<String, WindowEntry>>>,
    max_requests: u32,
    window_secs: u64,
}

struct WindowEntry {
    count: u32,
    reset_at: u64,
}

impl RateLimiter {
    pub fn new(max_requests: u32, window_secs: u64) -> Self {
        Self {
            windows: Arc::new(Mutex::new(HashMap::new())),
            max_requests,
            window_secs,
        }
    }

    pub async fn check(&self, key: &str) -> bool {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let mut windows = self.windows.lock().await;

        let entry = windows.entry(key.to_string()).or_insert(WindowEntry {
            count: 0,
            reset_at: now + self.window_secs,
        });

        if now >= entry.reset_at {
            entry.count = 0;
            entry.reset_at = now + self.window_secs;
        }

        entry.count += 1;
        entry.count <= self.max_requests
    }
}

fn get_client_key(req: &Request) -> String {
    // Use player ID if authenticated, otherwise IP
    if let Some(player) = req.extensions().get::<AuthPlayer>() {
        return format!("player:{}", player.id);
    }
    if let Some(ConnectInfo(addr)) = req.extensions().get::<ConnectInfo<SocketAddr>>() {
        return format!("ip:{}", addr.ip());
    }
    // Fallback: check forwarded headers
    req.headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(|v| format!("ip:{}", v.split(',').next().unwrap_or("unknown").trim()))
        .unwrap_or_else(|| "ip:unknown".to_string())
}

/// Middleware: general rate limiter (100 req/min).
pub async fn rate_limit(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let key = format!("global:{}", get_client_key(&req));
    if !state.rate_limiter.check(&key).await {
        return Err(AppError::RateLimited);
    }
    Ok(next.run(req).await)
}

/// Middleware: score submission rate limiter (30 req/min).
pub async fn score_rate_limit(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let key = format!("score:{}", get_client_key(&req));
    if !state.score_rate_limiter.check(&key).await {
        return Err(AppError::RateLimited);
    }
    Ok(next.run(req).await)
}
