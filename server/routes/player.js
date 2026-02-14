/**
 * Player Profile Routes
 * ======================
 * GET  /player/profile      - Get player profile with stats
 * PUT  /player/profile      - Update player profile
 * GET  /player/progress     - Get all game progress
 * GET  /player/achievements - Get achievements
 */

const express = require('express');
const db = require('../models/db');

const router = express.Router();

/**
 * Get full player profile with aggregated stats.
 */
router.get('/profile', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;

        const playerResult = await db.query(
            'SELECT * FROM players WHERE id = $1 AND tenant_id = $2',
            [playerId, tenantId]
        );

        if (playerResult.rows.length === 0) {
            return res.status(404).json({ error: 'Player not found' });
        }

        const player = playerResult.rows[0];

        // Aggregated game stats
        const statsResult = await db.query(`
            SELECT
                COUNT(*) FILTER (WHERE play_count > 0) as games_started,
                COUNT(*) FILTER (WHERE stars >= 1) as games_completed,
                COUNT(*) FILTER (WHERE stars = 3) as games_mastered,
                COALESCE(SUM(stars), 0) as total_stars,
                COALESCE(SUM(high_score), 0) as combined_high_scores
            FROM game_progress
            WHERE player_id = $1 AND tenant_id = $2
        `, [playerId, tenantId]);

        const stats = statsResult.rows[0];

        res.json({
            playerId: player.id,
            displayName: player.display_name,
            avatarCharacter: player.avatar_character,
            isGuest: player.is_guest,
            totalScore: parseInt(player.total_score, 10),
            gamesPlayed: player.games_played,
            totalPlayTime: player.total_play_time,
            createdAt: player.created_at,
            lastLoginAt: player.last_login_at,
            stats: {
                gamesStarted: parseInt(stats.games_started, 10),
                gamesCompleted: parseInt(stats.games_completed, 10),
                gamesMastered: parseInt(stats.games_mastered, 10),
                totalStars: parseInt(stats.total_stars, 10),
                maxStars: 25 * 3, // 25 games × 3 stars
                combinedHighScores: parseInt(stats.combined_high_scores, 10)
            }
        });
    } catch (err) {
        next(err);
    }
});

/**
 * Update player profile (display name, avatar).
 */
router.put('/profile', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const { displayName, avatarCharacter } = req.body;

        const updates = [];
        const values = [];
        let paramIndex = 3;

        if (displayName) {
            updates.push(`display_name = $${paramIndex++}`);
            values.push(displayName);
        }
        if (avatarCharacter) {
            updates.push(`avatar_character = $${paramIndex++}`);
            values.push(avatarCharacter);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No updates provided' });
        }

        const result = await db.query(
            `UPDATE players SET ${updates.join(', ')} WHERE id = $1 AND tenant_id = $2 RETURNING *`,
            [playerId, tenantId, ...values]
        );

        const player = result.rows[0];
        res.json({
            playerId: player.id,
            displayName: player.display_name,
            avatarCharacter: player.avatar_character
        });
    } catch (err) {
        next(err);
    }
});

/**
 * Get all game progress for the player.
 */
router.get('/progress', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;

        const result = await db.query(
            'SELECT * FROM game_progress WHERE player_id = $1 AND tenant_id = $2',
            [playerId, tenantId]
        );

        const progress = {};
        for (const row of result.rows) {
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

        res.json({ progress });
    } catch (err) {
        next(err);
    }
});

/**
 * Get player achievements.
 */
router.get('/achievements', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;

        const result = await db.query(
            'SELECT * FROM player_achievements WHERE player_id = $1 AND tenant_id = $2 ORDER BY earned_at DESC',
            [playerId, tenantId]
        );

        res.json({
            achievements: result.rows.map(row => ({
                id: row.achievement_id,
                earnedAt: row.earned_at,
                gameId: row.game_id
            }))
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
