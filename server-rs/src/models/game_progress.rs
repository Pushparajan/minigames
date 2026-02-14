use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct GameProgress {
    pub player_id: Uuid,
    pub tenant_id: String,
    pub game_id: String,
    pub high_score: i64,
    pub best_time: Option<i32>,
    pub level: i32,
    pub stars: i32,
    pub play_count: i32,
    pub total_score: i64,
    pub last_played_at: DateTime<Utc>,
    pub custom_data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ScoreHistory {
    pub player_id: Uuid,
    pub tenant_id: String,
    pub game_id: String,
    pub score: i64,
    pub level: Option<i32>,
    pub play_time: Option<i32>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct ScoreSubmitRequest {
    pub score: i64,
    pub time: Option<i32>,
    pub level: Option<i32>,
    #[serde(rename = "customData")]
    pub custom_data: Option<serde_json::Value>,
    pub timestamp: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct ScoreSubmitResponse {
    pub success: bool,
    #[serde(rename = "highScore")]
    pub high_score: i64,
    pub stars: i32,
    #[serde(rename = "isNewHighScore")]
    pub is_new_high_score: bool,
    #[serde(rename = "newAchievements")]
    pub new_achievements: Vec<String>,
}

/// Star thresholds per game: [1-star, 2-star, 3-star]
pub fn star_thresholds(game_id: &str) -> [i64; 3] {
    match game_id {
        "PhysicsMasterBilliards" => [200, 600, 1500],
        "STEMProjectVolley" => [300, 800, 1500],
        "DroneDefense" => [200, 500, 1000],
        "CampusDash" => [100, 300, 600],
        "ChemistryLab" => [150, 400, 900],
        "MathBlaster" => [200, 500, 1200],
        "BiologyExplorer" => [100, 350, 800],
        "CodeRunner" => [250, 600, 1400],
        "GeoQuest" => [150, 450, 1000],
        "RobotBuilder" => [200, 550, 1300],
        "SpaceNavigator" => [300, 700, 1500],
        "CircuitMaster" => [150, 400, 900],
        "EcoSystem" => [100, 300, 700],
        "DataDetective" => [200, 500, 1100],
        "WeatherStation" => [150, 400, 850],
        "LabSafety" => [100, 250, 600],
        "BridgeBuilder" => [200, 500, 1200],
        "StarMapper" => [150, 400, 900],
        "MicroWorld" => [100, 350, 800],
        "EnergyGrid" => [200, 500, 1100],
        "FossilHunter" => [150, 400, 900],
        "VolcanoLab" => [200, 500, 1000],
        "OceanExplorer" => [100, 300, 700],
        "GeneticLab" => [200, 600, 1300],
        "RocketScience" => [250, 600, 1400],
        _ => [100, 300, 600],
    }
}

pub fn calculate_stars(game_id: &str, score: i64) -> i32 {
    let thresholds = star_thresholds(game_id);
    if score >= thresholds[2] {
        3
    } else if score >= thresholds[1] {
        2
    } else if score >= thresholds[0] {
        1
    } else {
        0
    }
}
