use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use crate::cache::Cache;
use crate::error::AppResult;

fn shard_index(player_id: &str, shard_count: u32) -> u32 {
    let mut hasher = DefaultHasher::new();
    player_id.hash(&mut hasher);
    let hash = hasher.finish();
    (hash % shard_count as u64) as u32
}

fn lb_key(tenant_id: &str, game_id: &str, shard: u32) -> String {
    format!("lb:{}:{}:shard:{}", tenant_id, game_id, shard)
}

fn global_key(tenant_id: &str, shard: u32) -> String {
    format!("lb:{}:global:shard:{}", tenant_id, shard)
}

pub async fn update_score(
    cache: &Cache,
    tenant_id: &str,
    game_id: &str,
    player_id: &str,
    score: f64,
    shard_count: u32,
) {
    let shard = shard_index(player_id, shard_count);
    let key = lb_key(tenant_id, game_id, shard);
    cache.zadd(&key, player_id, score).await;
    cache.expire(&key, 7200).await;
}

pub async fn update_global_score(
    cache: &Cache,
    tenant_id: &str,
    player_id: &str,
    total_score: f64,
    shard_count: u32,
) {
    let shard = shard_index(player_id, shard_count);
    let key = global_key(tenant_id, shard);
    cache.zadd(&key, player_id, total_score).await;
    cache.expire(&key, 7200).await;
}

pub async fn get_top_k(
    cache: &Cache,
    tenant_id: &str,
    game_id: &str,
    k: usize,
    shard_count: u32,
) -> Vec<(String, f64)> {
    let mut all_entries = Vec::new();

    for shard in 0..shard_count {
        let key = lb_key(tenant_id, game_id, shard);
        let entries = cache.zrevrange_withscores(&key, 0, k as isize - 1).await;
        all_entries.extend(entries);
    }

    // Sort by score descending
    all_entries.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    all_entries.truncate(k);
    all_entries
}

pub async fn get_approx_rank(
    cache: &Cache,
    tenant_id: &str,
    game_id: &str,
    player_id: &str,
    shard_count: u32,
) -> Option<usize> {
    let shard = shard_index(player_id, shard_count);
    let key = lb_key(tenant_id, game_id, shard);

    let score = cache.zscore(&key, player_id).await?;

    let mut higher_count: usize = 0;
    for s in 0..shard_count {
        let k = lb_key(tenant_id, game_id, s);
        let entries = cache.zrevrange_withscores(&k, 0, -1).await;
        for (_, entry_score) in &entries {
            if *entry_score > score {
                higher_count += 1;
            }
        }
    }

    Some(higher_count + 1)
}

pub async fn get_global_top_k(
    cache: &Cache,
    tenant_id: &str,
    k: usize,
    shard_count: u32,
) -> Vec<(String, f64)> {
    let mut all_entries = Vec::new();

    for shard in 0..shard_count {
        let key = global_key(tenant_id, shard);
        let entries = cache.zrevrange_withscores(&key, 0, k as isize - 1).await;
        all_entries.extend(entries);
    }

    all_entries.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    all_entries.truncate(k);
    all_entries
}

pub async fn rebuild_from_db(
    db: &sqlx::PgPool,
    cache: &Cache,
    tenant_id: &str,
    game_id: &str,
    shard_count: u32,
) -> AppResult<usize> {
    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT player_id::text, high_score FROM game_progress WHERE tenant_id = $1 AND game_id = $2 ORDER BY high_score DESC LIMIT 10000",
    )
    .bind(tenant_id)
    .bind(game_id)
    .fetch_all(db)
    .await?;

    let count = rows.len();
    for (pid, score) in &rows {
        update_score(cache, tenant_id, game_id, pid, *score as f64, shard_count).await;
    }
    Ok(count)
}
