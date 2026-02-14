use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct GdprRequest {
    pub id: Uuid,
    pub tenant_id: String,
    pub player_id: Uuid,
    pub request_type: String,
    pub status: String,
    pub download_url: Option<String>,
    pub completed_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct ConsentRequest {
    pub consent: bool,
}

#[derive(Debug, Deserialize)]
pub struct DeleteRequest {
    pub confirmation: String,
}

#[derive(Debug, Deserialize)]
pub struct SyncOperation {
    pub id: Option<String>,
    pub action: String,
    #[serde(rename = "gameId")]
    pub game_id: Option<String>,
    pub score: Option<i64>,
    #[serde(rename = "highScore")]
    pub high_score: Option<i64>,
    pub stars: Option<i32>,
    pub level: Option<i32>,
    #[serde(rename = "playCount")]
    pub play_count: Option<i32>,
    pub timestamp: Option<i64>,
    pub player: Option<serde_json::Value>,
    pub settings: Option<serde_json::Value>,
    #[serde(rename = "customData")]
    pub custom_data: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct BatchSyncRequest {
    pub operations: Vec<SyncOperation>,
}
