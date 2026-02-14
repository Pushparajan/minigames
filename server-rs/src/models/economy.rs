use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlayerWallet {
    pub player_id: Uuid,
    pub tenant_id: String,
    pub currency_type: String,
    pub balance: i64,
    pub lifetime_earned: i64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct EconomyTransaction {
    pub id: Option<Uuid>,
    pub tenant_id: String,
    pub player_id: Uuid,
    pub currency_type: String,
    pub amount: i64,
    pub balance_after: i64,
    pub tx_type: String,
    pub source: String,
    pub reference_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct StoreItem {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub description: Option<String>,
    pub item_type: String,
    pub currency_type: String,
    pub price: i64,
    pub metadata: Option<serde_json::Value>,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlayerInventory {
    pub tenant_id: String,
    pub player_id: Uuid,
    pub item_id: String,
    pub source: String,
    pub acquired_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct BattlePass {
    pub id: String,
    pub tenant_id: String,
    pub season_id: Option<String>,
    pub max_tier: i32,
    pub xp_per_tier: i32,
    pub free_rewards: serde_json::Value,
    pub premium_rewards: serde_json::Value,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlayerBattlePass {
    pub tenant_id: String,
    pub player_id: Uuid,
    pub battle_pass_id: String,
    pub current_tier: i32,
    pub current_xp: i32,
    pub is_premium: bool,
    pub claimed_tiers: serde_json::Value,
    pub purchased_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct EarnRequest {
    #[serde(rename = "currencyType")]
    pub currency_type: String,
    pub amount: i64,
    pub source: String,
    #[serde(rename = "referenceId")]
    pub reference_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PurchaseRequest {
    #[serde(rename = "itemId")]
    pub item_id: String,
}

#[derive(Debug, Deserialize)]
pub struct ClaimTierRequest {
    pub tier: i32,
}

#[derive(Debug, Deserialize)]
pub struct AwardXpRequest {
    pub xp: i32,
    pub source: Option<String>,
}
