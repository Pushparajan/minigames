use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct LeaderboardEntry {
    pub tenant_id: String,
    pub player_id: Uuid,
    pub game_id: String,
    pub season_id: Option<String>,
    pub region: String,
    pub score: i64,
    pub wins: i32,
    pub losses: i32,
    pub draws: i32,
    pub matches_played: i32,
    pub skill_rating: f64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Season {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CustomGame {
    pub id: String,
    pub tenant_id: String,
    pub title: String,
    pub classic: Option<bool>,
    pub character_id: Option<String>,
    pub mechanic: Option<String>,
    pub icon_color: Option<String>,
    pub icon_emoji: Option<String>,
    pub scene_code: Option<String>,
    pub sort_order: i32,
    pub category_id: Option<String>,
    pub created_by: Option<Uuid>,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct GameCategory {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub icon_emoji: Option<String>,
    pub icon_color: Option<String>,
    pub sort_order: i32,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Room {
    pub id: String,
    pub game_id: String,
    pub host_id: Uuid,
    pub players: Vec<RoomPlayer>,
    pub max_players: i32,
    pub state: String,
    pub is_private: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomPlayer {
    pub id: Uuid,
    pub display_name: String,
    pub avatar_character: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateRoomRequest {
    #[serde(rename = "gameId")]
    pub game_id: String,
    #[serde(rename = "maxPlayers")]
    pub max_players: Option<i32>,
    #[serde(rename = "isPrivate")]
    pub is_private: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct MatchmakeRequest {
    #[serde(rename = "gameId")]
    pub game_id: String,
}

#[derive(Debug, Deserialize)]
pub struct SubmitMatchRequest {
    #[serde(rename = "gameId")]
    pub game_id: String,
    pub players: Vec<MatchPlayerResult>,
}

#[derive(Debug, Deserialize)]
pub struct MatchPlayerResult {
    #[serde(rename = "playerId")]
    pub player_id: String,
    pub score: i64,
    #[serde(rename = "isWinner")]
    pub is_winner: bool,
    pub placement: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct CreateGameRequest {
    pub id: String,
    pub title: String,
    pub classic: Option<bool>,
    #[serde(rename = "characterId")]
    pub character_id: Option<String>,
    pub mechanic: Option<String>,
    #[serde(rename = "iconColor")]
    pub icon_color: Option<String>,
    #[serde(rename = "iconEmoji")]
    pub icon_emoji: Option<String>,
    #[serde(rename = "sceneCode")]
    pub scene_code: Option<String>,
    #[serde(rename = "sortOrder")]
    pub sort_order: Option<i32>,
    pub categories: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateGameRequest {
    pub title: Option<String>,
    pub classic: Option<bool>,
    #[serde(rename = "characterId")]
    pub character_id: Option<String>,
    pub mechanic: Option<String>,
    #[serde(rename = "iconColor")]
    pub icon_color: Option<String>,
    #[serde(rename = "iconEmoji")]
    pub icon_emoji: Option<String>,
    #[serde(rename = "sceneCode")]
    pub scene_code: Option<String>,
    #[serde(rename = "sortOrder")]
    pub sort_order: Option<i32>,
    pub categories: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCategoryRequest {
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "iconEmoji")]
    pub icon_emoji: Option<String>,
    #[serde(rename = "iconColor")]
    pub icon_color: Option<String>,
    #[serde(rename = "sortOrder")]
    pub sort_order: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct AssignCategoriesRequest {
    pub categories: Vec<CategoryAssignment>,
}

#[derive(Debug, Deserialize)]
pub struct CategoryAssignment {
    #[serde(rename = "categoryId")]
    pub category_id: String,
    #[serde(rename = "sortOrder")]
    pub sort_order: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct PresenceUpdateRequest {
    pub status: String,
    #[serde(rename = "currentGameId")]
    pub current_game_id: Option<String>,
    #[serde(rename = "currentRoomId")]
    pub current_room_id: Option<String>,
}
