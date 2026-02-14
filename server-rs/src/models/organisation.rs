use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Organisation {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub slug: String,
    pub owner_id: Uuid,
    pub stripe_customer_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct OrganisationMember {
    pub organisation_id: String,
    pub player_id: Uuid,
    pub tenant_id: String,
    pub role: String,
    pub joined_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateOrgRequest {
    pub name: String,
    pub slug: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddMemberRequest {
    #[serde(rename = "playerId")]
    pub player_id: String,
    pub role: Option<String>,
}
