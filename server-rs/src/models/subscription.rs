use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Subscription {
    pub id: String,
    pub organisation_id: String,
    pub tenant_id: String,
    pub stripe_subscription_id: String,
    pub stripe_customer_id: String,
    pub stripe_price_id: Option<String>,
    pub status: String,
    pub plan_tier: String,
    pub trial_start: Option<DateTime<Utc>>,
    pub trial_end: Option<DateTime<Utc>>,
    pub current_period_start: Option<DateTime<Utc>>,
    pub current_period_end: Option<DateTime<Utc>>,
    pub cancel_at: Option<DateTime<Utc>>,
    pub canceled_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub metadata: Option<serde_json::Value>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Entitlement {
    pub organisation_id: String,
    pub subscription_id: Option<String>,
    pub tenant_id: String,
    pub feature_key: String,
    pub is_enabled: bool,
    pub limit_value: Option<i64>,
    pub usage_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UsageMeter {
    pub organisation_id: String,
    pub tenant_id: String,
    pub meter_key: String,
    pub period_start: DateTime<Utc>,
    pub period_end: DateTime<Utc>,
    pub count: i64,
    pub limit_value: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct StorageUsage {
    pub organisation_id: String,
    pub tenant_id: String,
    pub resource_type: String,
    pub resource_id: String,
    pub size_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlanDefinition {
    pub id: String,
    pub tenant_id: String,
    pub plan_tier: String,
    pub name: String,
    pub price_cents: i32,
    pub billing_period: String,
    pub max_members: i32,
    pub max_storage_mb: i32,
    pub max_games: i32,
    pub features_json: serde_json::Value,
    pub stripe_price_id: Option<String>,
    pub sort_order: i32,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct StripeEvent {
    pub id: String,
    pub tenant_id: String,
    pub event_type: String,
    pub payload: serde_json::Value,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct TrialHistory {
    pub player_id: uuid::Uuid,
    pub tenant_id: String,
    pub organisation_id: String,
    pub converted: bool,
    pub trial_ended_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct SubscribeRequest {
    #[serde(rename = "organisationId")]
    pub organisation_id: String,
    #[serde(rename = "priceId")]
    pub price_id: Option<String>,
    #[serde(rename = "planTier")]
    pub plan_tier: Option<String>,
    pub trial: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct PortalRequest {
    #[serde(rename = "organisationId")]
    pub organisation_id: String,
}

#[derive(Debug, Deserialize)]
pub struct CancelRequest {
    #[serde(rename = "organisationId")]
    pub organisation_id: String,
    pub immediate: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ResumeRequest {
    #[serde(rename = "organisationId")]
    pub organisation_id: String,
}

pub const ALL_FEATURES: &[&str] = &[
    "organisations",
    "multiplayer",
    "analytics_dashboard",
    "custom_branding",
    "api_access",
    "advanced_leaderboards",
    "export_data",
    "unlimited_games",
    "priority_support",
];

pub struct PlanEntitlements {
    pub max_members: i64,
    pub max_storage_mb: i64,
    pub max_games: i64,
    pub features: &'static [&'static str],
}

pub fn plan_entitlements(tier: &str) -> PlanEntitlements {
    match tier {
        "starter" => PlanEntitlements {
            max_members: 10,
            max_storage_mb: 1024,
            max_games: 15,
            features: &["organisations", "multiplayer", "advanced_leaderboards"],
        },
        "pro" => PlanEntitlements {
            max_members: 50,
            max_storage_mb: 10240,
            max_games: 25,
            features: &[
                "organisations",
                "multiplayer",
                "analytics_dashboard",
                "custom_branding",
                "api_access",
                "advanced_leaderboards",
                "export_data",
                "unlimited_games",
            ],
        },
        "enterprise" => PlanEntitlements {
            max_members: -1,
            max_storage_mb: -1,
            max_games: 25,
            features: ALL_FEATURES,
        },
        _ => PlanEntitlements {
            max_members: 1,
            max_storage_mb: 100,
            max_games: 5,
            features: &[],
        },
    }
}
