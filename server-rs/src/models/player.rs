use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Player {
    pub id: Uuid,
    pub tenant_id: String,
    pub email: Option<String>,
    #[serde(skip_serializing)]
    pub password_hash: Option<String>,
    pub display_name: String,
    pub avatar_character: String,
    pub is_guest: bool,
    pub total_score: i64,
    pub games_played: i32,
    pub total_play_time: Option<i32>,
    pub admin_role: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_login_at: Option<DateTime<Utc>>,
    pub gdpr_consent: Option<bool>,
    pub gdpr_consent_at: Option<DateTime<Utc>>,
    pub region: Option<String>,
    pub locale: Option<String>,
    pub data_deletion_requested_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct GuestRequest {
    #[serde(rename = "playerId")]
    pub player_id: Option<String>,
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    #[serde(rename = "avatarCharacter")]
    pub avatar_character: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    #[serde(rename = "avatarCharacter")]
    pub avatar_character: Option<String>,
    #[serde(rename = "playerId")]
    pub player_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct ProfileUpdateRequest {
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    #[serde(rename = "avatarCharacter")]
    pub avatar_character: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    #[serde(rename = "refreshToken")]
    pub refresh_token: String,
    pub player: PlayerPublic,
}

#[derive(Debug, Serialize)]
pub struct PlayerPublic {
    #[serde(rename = "playerId")]
    pub player_id: Uuid,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "avatarCharacter")]
    pub avatar_character: String,
    #[serde(rename = "isGuest")]
    pub is_guest: bool,
    #[serde(rename = "totalScore")]
    pub total_score: i64,
    #[serde(rename = "gamesPlayed")]
    pub games_played: i32,
    #[serde(rename = "createdAt")]
    pub created_at: DateTime<Utc>,
}

impl From<&Player> for PlayerPublic {
    fn from(p: &Player) -> Self {
        Self {
            player_id: p.id,
            display_name: p.display_name.clone(),
            avatar_character: p.avatar_character.clone(),
            is_guest: p.is_guest,
            total_score: p.total_score,
            games_played: p.games_played,
            created_at: p.created_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlayerAchievement {
    pub player_id: Uuid,
    pub tenant_id: String,
    pub achievement_id: String,
    pub game_id: Option<String>,
    pub earned_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Achievement {
    pub id: String,
    pub tenant_id: String,
    pub criteria_json: serde_json::Value,
    pub game_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Friendship {
    pub tenant_id: String,
    pub player_id: Uuid,
    pub friend_id: Uuid,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlayerPresence {
    pub player_id: Uuid,
    pub tenant_id: String,
    pub status: String,
    pub current_game_id: Option<String>,
    pub current_room_id: Option<String>,
    pub last_seen_at: DateTime<Utc>,
    pub connected_at: DateTime<Utc>,
    pub server_node: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlayerSettings {
    pub player_id: Uuid,
    pub tenant_id: String,
    pub settings_json: serde_json::Value,
    pub updated_at: DateTime<Utc>,
}
