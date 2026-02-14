/**
 * Score Submission Routes
 * ========================
 * POST /scores/:gameId - Submit a score for a game
 * GET  /scores/:gameId - Get player's scores for a game
 */

const express = require('express');
const db = require('../models/db');
const cache = require('../services/cache');
const { scoreRateLimiter } = require('../middleware/rateLimiter');
const config = require('../config');

const router = express.Router();

/**
 * Submit a score. Updates game progress, player totals,
 * and leaderboard sorted sets.
 */
router.post('/:gameId', scoreRateLimiter, async (req, res, next) => {
    try {
        const { gameId } = req.params;
        const { score, time, level, customData, timestamp } = req.body;
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;

        if (typeof score !== 'number' || score < 0) {
            return res.status(400).json({ error: 'Invalid score' });
        }

        // Server-side score validation (anti-cheat basic layer)
        if (score > 999999) {
            return res.status(400).json({ error: 'Score exceeds maximum' });
        }

        const result = await db.transaction(async (client) => {
            // Upsert game progress
            const progressResult = await client.query(`
                INSERT INTO game_progress (player_id, tenant_id, game_id, high_score, best_time, level, play_count, total_score, last_played_at)
                VALUES ($1, $2, $3, $4, $5, $6, 1, $4, NOW())
                ON CONFLICT (player_id, tenant_id, game_id) DO UPDATE SET
                    high_score = GREATEST(game_progress.high_score, EXCLUDED.high_score),
                    best_time = CASE
                        WHEN EXCLUDED.best_time IS NOT NULL AND (game_progress.best_time IS NULL OR EXCLUDED.best_time < game_progress.best_time)
                        THEN EXCLUDED.best_time
                        ELSE game_progress.best_time
                    END,
                    level = GREATEST(game_progress.level, EXCLUDED.level),
                    play_count = game_progress.play_count + 1,
                    total_score = game_progress.total_score + $4,
                    last_played_at = NOW()
                RETURNING *
            `, [playerId, tenantId, gameId, score, time || null, level || 1]);

            const progress = progressResult.rows[0];

            // Calculate stars
            const stars = _calculateStars(gameId, parseInt(progress.high_score, 10));
            await client.query(
                'UPDATE game_progress SET stars = $1 WHERE player_id = $2 AND tenant_id = $3 AND game_id = $4',
                [stars, playerId, tenantId, gameId]
            );

            // Update player totals
            await client.query(`
                UPDATE players SET
                    total_score = total_score + $1,
                    games_played = games_played + 1,
                    total_play_time = total_play_time + COALESCE($2, 0)
                WHERE id = $3 AND tenant_id = $4
            `, [score, time || 0, playerId, tenantId]);

            // Insert into score_history for detailed analytics
            await client.query(`
                INSERT INTO score_history (player_id, tenant_id, game_id, score, level, play_time)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [playerId, tenantId, gameId, score, level || 1, time || null]);

            return { ...progress, stars };
        });

        // Update leaderboard cache (async, non-blocking)
        _updateLeaderboardCache(tenantId, gameId, playerId, score).catch(err =>
            console.warn('Leaderboard cache update failed:', err.message)
        );

        const isNewHigh = parseInt(result.high_score, 10) === score;

        res.json({
            gameId,
            score,
            highScore: parseInt(result.high_score, 10),
            stars: result.stars,
            level: result.level,
            playCount: result.play_count,
            isNewHigh
        });
    } catch (err) {
        next(err);
    }
});

/**
 * Get player's progress for a specific game.
 */
router.get('/:gameId', async (req, res, next) => {
    try {
        const { gameId } = req.params;
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;

        const result = await db.query(
            'SELECT * FROM game_progress WHERE player_id = $1 AND tenant_id = $2 AND game_id = $3',
            [playerId, tenantId, gameId]
        );

        if (result.rows.length === 0) {
            return res.json({ gameId, highScore: 0, stars: 0, level: 1, playCount: 0 });
        }

        const row = result.rows[0];
        res.json({
            gameId,
            highScore: parseInt(row.high_score, 10),
            bestTime: row.best_time ? parseInt(row.best_time, 10) : null,
            stars: row.stars,
            level: row.level,
            playCount: row.play_count,
            totalScore: parseInt(row.total_score, 10),
            lastPlayed: row.last_played_at
        });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Helpers
// =========================================

function _calculateStars(gameId, score) {
    const thresholds = {
        PhysicsMasterBilliards: [200, 600, 1500],
        STEMProjectVolley: [300, 800, 1500],
        LogicronsGridShift: [100, 300, 500],
        DroneDefense: [200, 500, 1000],
        LabBreach: [150, 400, 800],
        GeologyDeepDive: [100, 300, 600],
        CampusDash: [500, 2000, 5000],
        SafetyFirstDefense: [200, 500, 1000],
        GravityShiftRun: [200, 500, 1500],
        DemoDay: [100, 250, 500],
        ChemistryEscape: [200, 500, 1000],
        RoverFieldTest: [200, 500, 1000],
        HydroLogicPuzzles: [100, 300, 500],
        ColorLabQuest: [200, 500, 1000],
        CableCarConundrum: [100, 300, 600],
        FindThePrincipal: [200, 500, 1000],
        FormulaSTEM: [300, 600, 1200],
        CampusGuard: [100, 300, 800],
        HistoryVaultEscape: [100, 300, 500],
        MolecularSplit: [200, 500, 1000],
        HeavyGearDelivery: [200, 500, 1000],
        AeroEngineering: [200, 500, 1000],
        RobotRepairBay: [100, 300, 500],
        ParkourLab: [300, 1000, 3000],
        STEMCelebration: [500, 1500, 3000]
    };

    const t = thresholds[gameId] || [100, 300, 500];
    if (score >= t[2]) return 3;
    if (score >= t[1]) return 2;
    if (score >= t[0]) return 1;
    return 0;
}

async function _updateLeaderboardCache(tenantId, gameId, playerId, score) {
    const shardIndex = _getShardIndex(playerId);
    const key = `lb:${tenantId}:${gameId}:shard:${shardIndex}`;
    await cache.zadd(key, score, playerId);
    await cache.expire(key, 3600); // 1 hour TTL

    // Also update the global player score
    const globalKey = `lb:${tenantId}:global:shard:${shardIndex}`;
    const currentScore = await cache.zscore(globalKey, playerId) || 0;
    await cache.zadd(globalKey, parseFloat(currentScore) + score, playerId);
    await cache.expire(globalKey, 3600);
}

function _getShardIndex(playerId) {
    let hash = 0;
    for (let i = 0; i < playerId.length; i++) {
        hash = ((hash << 5) - hash) + playerId.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash) % config.leaderboard.shardCount;
}

module.exports = router;
