use axum::{
    extract::{Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthPlayer;
use crate::middleware::tenant::TenantId;
use crate::models::economy::*;
use crate::routes::leaderboards::PaginationQuery;
use crate::AppState;

pub async fn get_wallet(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let rows: Vec<(String, i64, i64)> = sqlx::query_as(
        "SELECT currency_type, balance, lifetime_earned FROM player_wallets WHERE player_id = $1 AND tenant_id = $2",
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .fetch_all(&state.db)
    .await?;

    let mut wallets = json!({"coins": {"balance": 0, "lifetimeEarned": 0}, "gems": {"balance": 0, "lifetimeEarned": 0}, "tickets": {"balance": 0, "lifetimeEarned": 0}});
    for (ct, bal, earned) in &rows {
        wallets[ct] = json!({"balance": bal, "lifetimeEarned": earned});
    }

    Ok(Json(json!({ "wallet": wallets })))
}

pub async fn get_transactions(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Query(q): Query<PaginationQuery>,
) -> AppResult<Json<Value>> {
    let limit = q.limit.unwrap_or(20).min(50);
    let offset = q.offset.unwrap_or(0);

    let rows: Vec<(String, i64, i64, String, String, Option<String>, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        r#"SELECT currency_type, amount, balance_after, tx_type, source, reference_id, created_at
        FROM economy_transactions WHERE player_id = $1 AND tenant_id = $2
        ORDER BY created_at DESC LIMIT $3 OFFSET $4"#,
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;

    let txns: Vec<Value> = rows.iter().map(|(ct, amt, bal, tt, src, ref_id, created)| {
        json!({"currencyType": ct, "amount": amt, "balanceAfter": bal, "txType": tt, "source": src, "referenceId": ref_id, "createdAt": created})
    }).collect();

    Ok(Json(json!({ "transactions": txns })))
}

pub async fn earn(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Json(body): Json<EarnRequest>,
) -> AppResult<Json<Value>> {
    if body.amount <= 0 {
        return Err(AppError::BadRequest("Amount must be positive".into()));
    }

    let mut tx = state.db.begin().await?;

    let balance: i64 = sqlx::query_scalar(
        r#"INSERT INTO player_wallets (player_id, tenant_id, currency_type, balance, lifetime_earned, updated_at)
        VALUES ($1, $2, $3, $4, $4, NOW())
        ON CONFLICT (player_id, tenant_id, currency_type) DO UPDATE SET
            balance = player_wallets.balance + $4,
            lifetime_earned = player_wallets.lifetime_earned + $4,
            updated_at = NOW()
        RETURNING balance"#,
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .bind(&body.currency_type)
    .bind(body.amount)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO economy_transactions (tenant_id, player_id, currency_type, amount, balance_after, tx_type, source, reference_id, created_at) VALUES ($1, $2, $3, $4, $5, 'earn', $6, $7, NOW())",
    )
    .bind(&tenant.0 .0)
    .bind(player.id)
    .bind(&body.currency_type)
    .bind(body.amount)
    .bind(balance)
    .bind(&body.source)
    .bind(&body.reference_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Json(json!({"balance": balance, "currencyType": body.currency_type})))
}

#[derive(Deserialize)]
pub struct StoreQuery {
    #[serde(rename = "type")]
    pub item_type: Option<String>,
}

pub async fn list_store(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Query(q): Query<StoreQuery>,
) -> AppResult<Json<Value>> {
    let rows: Vec<StoreItem> = if let Some(ref t) = q.item_type {
        sqlx::query_as(
            "SELECT * FROM store_items WHERE tenant_id = $1 AND is_active = true AND item_type = $2 ORDER BY price",
        )
        .bind(&tenant.0 .0)
        .bind(t)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as(
            "SELECT * FROM store_items WHERE tenant_id = $1 AND is_active = true ORDER BY price",
        )
        .bind(&tenant.0 .0)
        .fetch_all(&state.db)
        .await?
    };

    Ok(Json(json!({ "items": rows })))
}

pub async fn purchase(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Json(body): Json<PurchaseRequest>,
) -> AppResult<Json<Value>> {
    let tid = &tenant.0 .0;

    // Get item
    let item: StoreItem = sqlx::query_as(
        "SELECT * FROM store_items WHERE id = $1 AND tenant_id = $2 AND is_active = true",
    )
    .bind(&body.item_id)
    .bind(tid)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Item not found".into()))?;

    // Check already owned
    let owned: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM player_inventory WHERE player_id = $1 AND tenant_id = $2 AND item_id = $3)",
    )
    .bind(player.id)
    .bind(tid)
    .bind(&body.item_id)
    .fetch_one(&state.db)
    .await?;

    if owned {
        return Err(AppError::Conflict("Already owned".into()));
    }

    let mut tx = state.db.begin().await?;

    // Check and debit balance
    let balance: Option<i64> = sqlx::query_scalar(
        "SELECT balance FROM player_wallets WHERE player_id = $1 AND tenant_id = $2 AND currency_type = $3 FOR UPDATE",
    )
    .bind(player.id)
    .bind(tid)
    .bind(&item.currency_type)
    .fetch_optional(&mut *tx)
    .await?;

    let current = balance.unwrap_or(0);
    if current < item.price {
        return Err(AppError::BadRequest("Insufficient balance".into()));
    }

    let new_balance = current - item.price;

    sqlx::query("UPDATE player_wallets SET balance = $1, updated_at = NOW() WHERE player_id = $2 AND tenant_id = $3 AND currency_type = $4")
        .bind(new_balance).bind(player.id).bind(tid).bind(&item.currency_type)
        .execute(&mut *tx).await?;

    sqlx::query("INSERT INTO economy_transactions (tenant_id, player_id, currency_type, amount, balance_after, tx_type, source, reference_id, created_at) VALUES ($1, $2, $3, $4, $5, 'spend', 'store', $6, NOW())")
        .bind(tid).bind(player.id).bind(&item.currency_type).bind(-item.price).bind(new_balance).bind(&body.item_id)
        .execute(&mut *tx).await?;

    sqlx::query("INSERT INTO player_inventory (tenant_id, player_id, item_id, source, acquired_at) VALUES ($1, $2, $3, 'store', NOW())")
        .bind(tid).bind(player.id).bind(&body.item_id)
        .execute(&mut *tx).await?;

    tx.commit().await?;

    Ok(Json(json!({"success": true, "newBalance": new_balance})))
}

pub async fn inventory(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let rows: Vec<(String, String, String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        r#"SELECT pi.item_id, si.name, pi.source, pi.acquired_at
        FROM player_inventory pi
        JOIN store_items si ON si.id = pi.item_id AND si.tenant_id = pi.tenant_id
        WHERE pi.player_id = $1 AND pi.tenant_id = $2
        ORDER BY pi.acquired_at DESC"#,
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .fetch_all(&state.db)
    .await?;

    let items: Vec<Value> = rows.iter().map(|(id, name, source, acquired)| {
        json!({"itemId": id, "name": name, "source": source, "acquiredAt": acquired})
    }).collect();

    Ok(Json(json!({ "inventory": items })))
}

pub async fn get_battlepass(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let bp: Option<BattlePass> = sqlx::query_as(
        "SELECT * FROM battle_passes WHERE tenant_id = $1 AND is_active = true LIMIT 1",
    )
    .bind(&tenant.0 .0)
    .fetch_optional(&state.db)
    .await?;

    Ok(Json(json!({ "battlePass": bp })))
}

pub async fn get_battlepass_progress(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let progress: Option<PlayerBattlePass> = sqlx::query_as(
        "SELECT * FROM player_battle_pass WHERE player_id = $1 AND tenant_id = $2 ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(player.id)
    .bind(&tenant.0 .0)
    .fetch_optional(&state.db)
    .await?;

    Ok(Json(json!({ "progress": progress })))
}

pub async fn purchase_battlepass(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let tid = &tenant.0 .0;
    let gem_cost = 500i64;

    let mut tx = state.db.begin().await?;

    let balance: Option<i64> = sqlx::query_scalar(
        "SELECT balance FROM player_wallets WHERE player_id = $1 AND tenant_id = $2 AND currency_type = 'gems' FOR UPDATE",
    )
    .bind(player.id).bind(tid).fetch_optional(&mut *tx).await?;

    let current = balance.unwrap_or(0);
    if current < gem_cost {
        return Err(AppError::BadRequest("Insufficient gems".into()));
    }

    sqlx::query("UPDATE player_wallets SET balance = balance - $1, updated_at = NOW() WHERE player_id = $2 AND tenant_id = $3 AND currency_type = 'gems'")
        .bind(gem_cost).bind(player.id).bind(tid)
        .execute(&mut *tx).await?;

    sqlx::query(
        r#"UPDATE player_battle_pass SET is_premium = true, purchased_at = NOW(), updated_at = NOW()
        WHERE player_id = $1 AND tenant_id = $2"#,
    )
    .bind(player.id).bind(tid)
    .execute(&mut *tx).await?;

    tx.commit().await?;

    Ok(Json(json!({"success": true})))
}

pub async fn claim_tier(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Json(body): Json<ClaimTierRequest>,
) -> AppResult<Json<Value>> {
    let tid = &tenant.0 .0;

    let progress: Option<PlayerBattlePass> = sqlx::query_as(
        "SELECT * FROM player_battle_pass WHERE player_id = $1 AND tenant_id = $2 ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(player.id).bind(tid).fetch_optional(&state.db).await?;

    let progress = progress.ok_or_else(|| AppError::NotFound("No battle pass".into()))?;

    if body.tier > progress.current_tier {
        return Err(AppError::BadRequest("Tier not yet reached".into()));
    }

    let claimed: Vec<i32> = serde_json::from_value(progress.claimed_tiers.clone()).unwrap_or_default();
    if claimed.contains(&body.tier) {
        return Err(AppError::Conflict("Tier already claimed".into()));
    }

    let mut new_claimed = claimed;
    new_claimed.push(body.tier);

    sqlx::query("UPDATE player_battle_pass SET claimed_tiers = $1, updated_at = NOW() WHERE player_id = $2 AND tenant_id = $3 AND battle_pass_id = $4")
        .bind(json!(new_claimed)).bind(player.id).bind(tid).bind(&progress.battle_pass_id)
        .execute(&state.db).await?;

    Ok(Json(json!({"success": true, "claimedTiers": new_claimed})))
}

pub async fn award_xp(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Json(body): Json<AwardXpRequest>,
) -> AppResult<Json<Value>> {
    let tid = &tenant.0 .0;

    let bp: Option<BattlePass> = sqlx::query_as(
        "SELECT * FROM battle_passes WHERE tenant_id = $1 AND is_active = true LIMIT 1",
    )
    .bind(tid).fetch_optional(&state.db).await?;

    let bp = match bp {
        Some(b) => b,
        None => return Ok(Json(json!({"success": false, "message": "No active battle pass"}))),
    };

    // Upsert progress
    sqlx::query(
        r#"INSERT INTO player_battle_pass (tenant_id, player_id, battle_pass_id, current_tier, current_xp, is_premium, claimed_tiers, updated_at)
        VALUES ($1, $2, $3, 0, $4, false, '[]'::jsonb, NOW())
        ON CONFLICT (tenant_id, player_id, battle_pass_id) DO UPDATE SET
            current_xp = player_battle_pass.current_xp + $4,
            updated_at = NOW()"#,
    )
    .bind(tid).bind(player.id).bind(&bp.id).bind(body.xp)
    .execute(&state.db).await?;

    // Check level up
    let progress: PlayerBattlePass = sqlx::query_as(
        "SELECT * FROM player_battle_pass WHERE player_id = $1 AND tenant_id = $2 AND battle_pass_id = $3",
    )
    .bind(player.id).bind(tid).bind(&bp.id)
    .fetch_one(&state.db).await?;

    let mut tier = progress.current_tier;
    let mut xp = progress.current_xp;
    while xp >= bp.xp_per_tier && tier < bp.max_tier {
        xp -= bp.xp_per_tier;
        tier += 1;
    }

    if tier != progress.current_tier || xp != progress.current_xp {
        sqlx::query("UPDATE player_battle_pass SET current_tier = $1, current_xp = $2, updated_at = NOW() WHERE player_id = $3 AND tenant_id = $4 AND battle_pass_id = $5")
            .bind(tier).bind(xp).bind(player.id).bind(tid).bind(&bp.id)
            .execute(&state.db).await?;
    }

    Ok(Json(json!({"currentTier": tier, "currentXp": xp, "xpToNextTier": bp.xp_per_tier - xp})))
}
