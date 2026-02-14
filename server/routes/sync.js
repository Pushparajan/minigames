/**
 * Batch Sync Routes
 * ==================
 * POST /sync/batch - Process queued sync operations from the client.
 *
 * The client accumulates operations offline and sends them
 * in batches when connectivity is restored.
 */

const express = require('express');
const db = require('../models/db');
const cache = require('../services/cache');

const router = express.Router();

const MAX_BATCH_SIZE = 50;

/**
 * Process a batch of sync operations.
 * Returns list of successfully processed IDs and any merged cloud data.
 */
router.post('/batch', async (req, res, next) => {
    try {
        const { operations } = req.body;
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;

        if (!Array.isArray(operations) || operations.length === 0) {
            return res.status(400).json({ error: 'Operations array required' });
        }

        if (operations.length > MAX_BATCH_SIZE) {
            return res.status(400).json({
                error: `Batch too large. Maximum ${MAX_BATCH_SIZE} operations.`
            });
        }

        const processed = [];
        const errors = [];

        // Sort by timestamp for ordered processing
        const sorted = [...operations].sort((a, b) => a.timestamp - b.timestamp);

        for (const op of sorted) {
            try {
                await _processOperation(playerId, tenantId, op);
                processed.push(op.id);
            } catch (err) {
                errors.push({ id: op.id, error: err.message });
            }
        }

        // Fetch latest merged data to send back
        const mergedData = await _getMergedData(playerId, tenantId);

        res.json({
            processed,
            errors: errors.length > 0 ? errors : undefined,
            mergedData
        });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Operation Processors
// =========================================

async function _processOperation(playerId, tenantId, op) {
    switch (op.action) {
        case 'score_submit':
            return _processScoreSubmit(playerId, tenantId, op.payload);
        case 'player_update':
            return _processPlayerUpdate(playerId, tenantId, op.payload);
        case 'settings_update':
            return _processSettingsUpdate(playerId, tenantId, op.payload);
        case 'custom_data':
            return _processCustomData(playerId, tenantId, op.payload);
        default:
            throw new Error(`Unknown action: ${op.action}`);
    }
}

async function _processScoreSubmit(playerId, tenantId, payload) {
    const { gameId, score, highScore, stars, level, playCount, timestamp } = payload;

    await db.query(`
        INSERT INTO game_progress (player_id, tenant_id, game_id, high_score, stars, level, play_count, total_score, last_played_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $4, to_timestamp($8::double precision / 1000))
        ON CONFLICT (player_id, tenant_id, game_id) DO UPDATE SET
            high_score = GREATEST(game_progress.high_score, EXCLUDED.high_score),
            stars = GREATEST(game_progress.stars, EXCLUDED.stars),
            level = GREATEST(game_progress.level, EXCLUDED.level),
            play_count = GREATEST(game_progress.play_count, EXCLUDED.play_count),
            total_score = game_progress.total_score + $4,
            last_played_at = GREATEST(game_progress.last_played_at, EXCLUDED.last_played_at)
    `, [playerId, tenantId, gameId, score, stars || 0, level || 1, playCount || 1, timestamp]);

    // Insert score history
    await db.query(`
        INSERT INTO score_history (player_id, tenant_id, game_id, score, level, created_at)
        VALUES ($1, $2, $3, $4, $5, to_timestamp($6::double precision / 1000))
    `, [playerId, tenantId, gameId, score, level || 1, timestamp]);
}

async function _processPlayerUpdate(playerId, tenantId, payload) {
    const { player } = payload;
    if (!player) return;

    await db.query(`
        UPDATE players SET
            display_name = COALESCE($3, display_name),
            avatar_character = COALESCE($4, avatar_character),
            total_score = GREATEST(total_score, $5),
            games_played = GREATEST(games_played, $6)
        WHERE id = $1 AND tenant_id = $2
    `, [playerId, tenantId, player.displayName, player.avatarCharacter,
        player.totalScore || 0, player.gamesPlayed || 0]);
}

async function _processSettingsUpdate(playerId, tenantId, payload) {
    const { settings } = payload;
    if (!settings) return;

    await db.query(`
        INSERT INTO player_settings (player_id, tenant_id, settings_json, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (player_id, tenant_id) DO UPDATE SET
            settings_json = EXCLUDED.settings_json,
            updated_at = NOW()
    `, [playerId, tenantId, JSON.stringify(settings)]);
}

async function _processCustomData(playerId, tenantId, payload) {
    const { gameId, customData } = payload;
    if (!gameId || !customData) return;

    await db.query(`
        UPDATE game_progress SET
            custom_data = custom_data || $4::jsonb
        WHERE player_id = $1 AND tenant_id = $2 AND game_id = $3
    `, [playerId, tenantId, gameId, JSON.stringify(customData)]);
}

// =========================================
// Merged Data Response
// =========================================

async function _getMergedData(playerId, tenantId) {
    const playerResult = await db.query(
        'SELECT * FROM players WHERE id = $1 AND tenant_id = $2',
        [playerId, tenantId]
    );

    const progressResult = await db.query(
        'SELECT * FROM game_progress WHERE player_id = $1 AND tenant_id = $2',
        [playerId, tenantId]
    );

    const settingsResult = await db.query(
        'SELECT settings_json, updated_at FROM player_settings WHERE player_id = $1 AND tenant_id = $2',
        [playerId, tenantId]
    );

    const player = playerResult.rows[0];
    const progress = {};
    for (const row of progressResult.rows) {
        progress[row.game_id] = {
            highScore: parseInt(row.high_score, 10),
            bestTime: row.best_time ? parseInt(row.best_time, 10) : null,
            level: row.level,
            stars: row.stars,
            playCount: row.play_count,
            totalScore: parseInt(row.total_score, 10),
            lastPlayed: row.last_played_at
        };
    }

    return {
        player: player ? {
            totalScore: parseInt(player.total_score, 10),
            gamesPlayed: player.games_played,
            achievements: []
        } : null,
        progress,
        settings: settingsResult.rows.length > 0
            ? { ...settingsResult.rows[0].settings_json, _timestamp: new Date(settingsResult.rows[0].updated_at).getTime() }
            : null
    };
}

module.exports = router;
