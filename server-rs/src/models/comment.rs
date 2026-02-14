use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Comment {
    pub id: Uuid,
    pub player_id: Uuid,
    pub tenant_id: String,
    pub game_id: String,
    pub parent_id: Option<Uuid>,
    pub body: String,
    pub status: String,
    pub report_count: i32,
    pub moderated_by: Option<Uuid>,
    pub moderation_note: Option<String>,
    pub created_at: DateTime<Utc>,
    pub edited_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct GameReview {
    pub id: Uuid,
    pub player_id: Uuid,
    pub tenant_id: String,
    pub game_id: String,
    pub rating: i32,
    pub title: Option<String>,
    pub body: Option<String>,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ContentReport {
    pub id: Option<Uuid>,
    pub reporter_id: Uuid,
    pub tenant_id: String,
    pub content_type: String,
    pub content_id: Uuid,
    pub reason: String,
    pub description: Option<String>,
    pub status: String,
    pub resolved_by: Option<Uuid>,
    pub resolution_note: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ModerationLog {
    pub admin_id: Uuid,
    pub tenant_id: String,
    pub action: String,
    pub content_type: Option<String>,
    pub content_id: Option<String>,
    pub target_player_id: Option<Uuid>,
    pub reason: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct PostCommentRequest {
    pub body: String,
    #[serde(rename = "parentId")]
    pub parent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EditCommentRequest {
    pub body: String,
}

#[derive(Debug, Deserialize)]
pub struct PostReviewRequest {
    pub rating: i32,
    pub title: Option<String>,
    pub body: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ReportRequest {
    pub reason: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ResolveReportRequest {
    pub action: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SetRoleRequest {
    pub role: String,
}

#[derive(Debug, Deserialize)]
pub struct WarnRequest {
    pub reason: String,
}
