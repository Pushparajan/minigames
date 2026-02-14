use chrono::{Datelike, NaiveDate, Utc};
use serde::Serialize;
use std::collections::HashMap;

use crate::error::{AppError, AppResult};

#[derive(Debug, Serialize)]
pub struct MeterStatus {
    pub meter_key: String,
    pub count: i64,
    pub limit_value: Option<i64>,
    pub remaining: Option<i64>,
    pub usage_pct: Option<f64>,
}

pub struct MeterLimits {
    pub api_calls: Option<i64>,
    pub game_sessions: Option<i64>,
    pub data_exports: Option<i64>,
}

pub fn meter_limits_for_tier(tier: &str) -> MeterLimits {
    match tier {
        "starter" => MeterLimits {
            api_calls: Some(50_000),
            game_sessions: Some(10_000),
            data_exports: Some(50),
        },
        "pro" => MeterLimits {
            api_calls: Some(500_000),
            game_sessions: Some(100_000),
            data_exports: Some(500),
        },
        "enterprise" => MeterLimits {
            api_calls: None,
            game_sessions: None,
            data_exports: None,
        },
        _ => MeterLimits {
            api_calls: Some(1_000),
            game_sessions: Some(500),
            data_exports: Some(5),
        },
    }
}

fn current_period() -> (chrono::NaiveDateTime, chrono::NaiveDateTime) {
    let now = Utc::now().naive_utc();
    let start = NaiveDate::from_ymd_opt(now.year(), now.month(), 1)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap();
    let end = if now.month() == 12 {
        NaiveDate::from_ymd_opt(now.year() + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(now.year(), now.month() + 1, 1)
    }
    .unwrap()
    .and_hms_opt(0, 0, 0)
    .unwrap();
    (start, end)
}

pub async fn increment(
    db: &sqlx::PgPool,
    organisation_id: &str,
    tenant_id: &str,
    meter_key: &str,
    amount: i64,
) -> AppResult<MeterStatus> {
    let (period_start, period_end) = current_period();

    let row: (i64, Option<i64>) = sqlx::query_as(
        r#"INSERT INTO usage_meters (organisation_id, tenant_id, meter_key, period_start, period_end, count, limit_value)
        VALUES ($1, $2, $3, $4, $5, $6, NULL)
        ON CONFLICT (organisation_id, meter_key, period_start) DO UPDATE
            SET count = usage_meters.count + $6
        RETURNING count, limit_value"#,
    )
    .bind(organisation_id)
    .bind(tenant_id)
    .bind(meter_key)
    .bind(period_start)
    .bind(period_end)
    .bind(amount)
    .fetch_one(db)
    .await?;

    let count = row.0;
    let limit_value = row.1;
    let remaining = limit_value.map(|l| (l - count).max(0));
    let usage_pct = limit_value.map(|l| if l > 0 { count as f64 / l as f64 * 100.0 } else { 0.0 });

    Ok(MeterStatus {
        meter_key: meter_key.to_string(),
        count,
        limit_value,
        remaining,
        usage_pct,
    })
}

pub async fn get_status(
    db: &sqlx::PgPool,
    organisation_id: &str,
    tenant_id: &str,
    meter_key: &str,
) -> AppResult<MeterStatus> {
    let (period_start, _) = current_period();

    let row: Option<(i64, Option<i64>)> = sqlx::query_as(
        "SELECT count, limit_value FROM usage_meters WHERE organisation_id = $1 AND tenant_id = $2 AND meter_key = $3 AND period_start = $4",
    )
    .bind(organisation_id)
    .bind(tenant_id)
    .bind(meter_key)
    .bind(period_start)
    .fetch_optional(db)
    .await?;

    let (count, limit_value) = row.unwrap_or((0, None));
    let remaining = limit_value.map(|l| (l - count).max(0));
    let usage_pct = limit_value.map(|l| if l > 0 { count as f64 / l as f64 * 100.0 } else { 0.0 });

    Ok(MeterStatus {
        meter_key: meter_key.to_string(),
        count,
        limit_value,
        remaining,
        usage_pct,
    })
}

pub async fn get_all_statuses(
    db: &sqlx::PgPool,
    organisation_id: &str,
    tenant_id: &str,
) -> AppResult<Vec<MeterStatus>> {
    let mut statuses = Vec::new();
    for key in &["api_calls", "game_sessions", "data_exports"] {
        statuses.push(get_status(db, organisation_id, tenant_id, key).await?);
    }
    Ok(statuses)
}

pub async fn has_quota(
    db: &sqlx::PgPool,
    organisation_id: &str,
    tenant_id: &str,
    meter_key: &str,
    amount: i64,
) -> AppResult<bool> {
    let status = get_status(db, organisation_id, tenant_id, meter_key).await?;
    match status.limit_value {
        None => Ok(true), // Unlimited
        Some(limit) => Ok(status.count + amount <= limit),
    }
}
