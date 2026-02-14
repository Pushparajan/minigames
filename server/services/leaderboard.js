/**
 * Leaderboard Service
 * ====================
 * Sharded leaderboard engine using Redis sorted sets.
 *
 * Architecture for 1M+ players:
 * - Scores distributed across N shards (consistent hashing by playerId)
 * - Shard merging for top-K queries
 * - Hot cache for frequently accessed pages
 * - Background refresh for stale shards
 *
 * Redis key structure:
 *   stem:lb:{tenantId}:{gameId}:shard:{n}  → ZSET (score → playerId)
 *   stem:lb:{tenantId}:global:shard:{n}    → ZSET (totalScore → playerId)
 *   stem:lb_result:{...}                   → Cached JSON result
 */

const cache = require('./cache');
const db = require('../models/db');
const config = require('../config');

const SHARD_COUNT = config.leaderboard.shardCount;

/**
 * Update a player's score in the sharded leaderboard.
 */
async function updateScore(tenantId, gameId, playerId, score) {
    const shard = _shardFor(playerId);

    // Per-game leaderboard
    const gameKey = `lb:${tenantId}:${gameId}:shard:${shard}`;
    const existing = await cache.zscore(gameKey, playerId);
    if (!existing || score > parseFloat(existing)) {
        await cache.zadd(gameKey, score, playerId);
    }
    await cache.expire(gameKey, 7200); // 2 hour TTL

    // Invalidate cached results for this game
    await _invalidateResultCache(tenantId, gameId);
}

/**
 * Update a player's global total score.
 */
async function updateGlobalScore(tenantId, playerId, totalScore) {
    const shard = _shardFor(playerId);
    const key = `lb:${tenantId}:global:shard:${shard}`;
    await cache.zadd(key, totalScore, playerId);
    await cache.expire(key, 7200);
}

/**
 * Get top-K entries by merging all shards.
 * This is O(K * SHARD_COUNT) which is efficient for reasonable K values.
 */
async function getTopK(tenantId, gameId, k = 50) {
    const candidates = [];

    // Gather top-K from each shard
    for (let s = 0; s < SHARD_COUNT; s++) {
        const key = `lb:${tenantId}:${gameId}:shard:${s}`;
        const entries = await cache.zrevrange(key, 0, k - 1, true);
        if (entries) {
            for (const entry of entries) {
                candidates.push({
                    playerId: entry.value,
                    score: entry.score
                });
            }
        }
    }

    // Sort merged candidates and take top K
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, k);
}

/**
 * Get a player's approximate rank by counting higher scores across shards.
 */
async function getApproxRank(tenantId, gameId, playerId) {
    const shard = _shardFor(playerId);
    const key = `lb:${tenantId}:${gameId}:shard:${shard}`;

    const score = await cache.zscore(key, playerId);
    if (score === null) return null;

    // Count players with higher scores across all shards
    let higherCount = 0;
    for (let s = 0; s < SHARD_COUNT; s++) {
        const shardKey = `lb:${tenantId}:${gameId}:shard:${s}`;
        // Count entries with score > player's score
        const count = await cache.zcard(shardKey);
        if (count > 0) {
            // Approximate: assume uniform distribution within shard
            const topEntries = await cache.zrevrange(shardKey, 0, 0, true);
            if (topEntries && topEntries.length > 0 && topEntries[0].score > score) {
                // Binary estimate of how many are above
                higherCount += Math.round(count * 0.5); // rough approx
            }
        }
    }

    return higherCount + 1;
}

/**
 * Rebuild leaderboard cache from database.
 * Run periodically or on cache miss.
 */
async function rebuildFromDB(tenantId, gameId) {
    const result = await db.query(`
        SELECT player_id, high_score
        FROM game_progress
        WHERE tenant_id = $1 AND game_id = $2 AND high_score > 0
        ORDER BY high_score DESC
        LIMIT 10000
    `, [tenantId, gameId]);

    for (const row of result.rows) {
        const shard = _shardFor(row.player_id);
        const key = `lb:${tenantId}:${gameId}:shard:${shard}`;
        await cache.zadd(key, parseInt(row.high_score, 10), row.player_id);
        await cache.expire(key, 7200);
    }

    console.log(`Leaderboard rebuilt: ${tenantId}/${gameId} (${result.rows.length} entries)`);
}

// =========================================
// Internal
// =========================================

function _shardFor(playerId) {
    let hash = 0;
    for (let i = 0; i < playerId.length; i++) {
        hash = ((hash << 5) - hash) + playerId.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash) % SHARD_COUNT;
}

async function _invalidateResultCache(tenantId, gameId) {
    // Invalidate common cached result keys
    const periods = ['all', 'daily', 'weekly', 'monthly'];
    for (const period of periods) {
        await cache.del(`lb_result:${tenantId}:${gameId}:${period}:0:50`);
    }
}

module.exports = {
    updateScore,
    updateGlobalScore,
    getTopK,
    getApproxRank,
    rebuildFromDB
};
