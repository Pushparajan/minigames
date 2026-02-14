/**
 * Leaderboard Routes
 * ===================
 * Sharded leaderboard system designed for 1M+ players.
 * Uses Redis sorted sets with shard merging for queries.
 * Extended with season-aware, regional, and multiplayer rankings.
 *
 * GET /leaderboards/:gameId          - Global leaderboard for a game
 * GET /leaderboards/:gameId/me       - Current player's rank
 * GET /leaderboards/:gameId/around   - Nearby ranks around player
 * GET /leaderboards/:gameId/friends  - Friend leaderboard
 * GET /leaderboards/:gameId/ranked   - Season/region multiplayer leaderboard
 * GET /leaderboards/global           - Aggregate across all games
 * GET /leaderboards/seasons          - List all seasons
 * GET /leaderboards/seasons/current  - Current active season
 * POST /leaderboards/submit-match    - Submit multiplayer match result
 */

const express = require('express');
const db = require('../models/db');
const cache = require('../services/cache');
const config = require('../config');

const router = express.Router();

/**
 * Get leaderboard for a specific game.
 * Tries Redis cache first, falls back to PostgreSQL.
 */
router.get('/:gameId', async (req, res, next) => {
    try {
        const { gameId } = req.params;
        const tenantId = req.tenantId;
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
        const offset = parseInt(req.query.offset, 10) || 0;
        const period = req.query.period || 'all';

        // Try cache first
        const cacheKey = `lb_result:${tenantId}:${gameId}:${period}:${offset}:${limit}`;
        const cached = await cache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        // Fallback to DB
        let query;
        const params = [tenantId, gameId, limit, offset];

        if (period === 'all') {
            query = `
                SELECT gp.player_id, gp.high_score, gp.stars, gp.level, gp.play_count,
                       p.display_name, p.avatar_character,
                       RANK() OVER (ORDER BY gp.high_score DESC) as rank
                FROM game_progress gp
                JOIN players p ON p.id = gp.player_id AND p.tenant_id = gp.tenant_id
                WHERE gp.tenant_id = $1 AND gp.game_id = $2 AND gp.high_score > 0
                ORDER BY gp.high_score DESC
                LIMIT $3 OFFSET $4
            `;
        } else {
            // Time-filtered: use score_history
            const periodFilter = _getPeriodFilter(period);
            query = `
                SELECT sh.player_id, MAX(sh.score) as high_score,
                       p.display_name, p.avatar_character,
                       RANK() OVER (ORDER BY MAX(sh.score) DESC) as rank
                FROM score_history sh
                JOIN players p ON p.id = sh.player_id AND p.tenant_id = sh.tenant_id
                WHERE sh.tenant_id = $1 AND sh.game_id = $2 AND sh.created_at >= $5
                GROUP BY sh.player_id, p.display_name, p.avatar_character
                ORDER BY high_score DESC
                LIMIT $3 OFFSET $4
            `;
            params.push(periodFilter);
        }

        const result = await db.query(query, params);

        // Count total entries
        const countResult = await db.query(
            'SELECT COUNT(*) FROM game_progress WHERE tenant_id = $1 AND game_id = $2 AND high_score > 0',
            [tenantId, gameId]
        );

        const response = {
            gameId,
            period,
            total: parseInt(countResult.rows[0].count, 10),
            offset,
            limit,
            entries: result.rows.map(row => ({
                rank: parseInt(row.rank, 10),
                playerId: row.player_id,
                displayName: row.display_name,
                avatarCharacter: row.avatar_character,
                highScore: parseInt(row.high_score, 10),
                stars: row.stars,
                level: row.level,
                playCount: row.play_count
            }))
        };

        // Cache for configured duration
        await cache.set(cacheKey, response, config.leaderboard.cacheSeconds);

        res.json(response);
    } catch (err) {
        next(err);
    }
});

/**
 * Get current player's rank.
 */
router.get('/:gameId/me', async (req, res, next) => {
    try {
        if (!req.player) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { gameId } = req.params;
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;

        const result = await db.query(`
            SELECT player_id, high_score, stars, level, play_count,
                   (SELECT COUNT(*) + 1 FROM game_progress
                    WHERE tenant_id = $1 AND game_id = $2 AND high_score > gp.high_score) as rank
            FROM game_progress gp
            WHERE player_id = $3 AND tenant_id = $1 AND game_id = $2
        `, [tenantId, gameId, playerId]);

        if (result.rows.length === 0) {
            return res.json({ gameId, rank: null, highScore: 0 });
        }

        const row = result.rows[0];
        res.json({
            gameId,
            rank: parseInt(row.rank, 10),
            highScore: parseInt(row.high_score, 10),
            stars: row.stars,
            level: row.level,
            playCount: row.play_count
        });
    } catch (err) {
        next(err);
    }
});

/**
 * Get leaderboard entries around the current player.
 */
router.get('/:gameId/around', async (req, res, next) => {
    try {
        if (!req.player) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { gameId } = req.params;
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const range = Math.min(parseInt(req.query.range, 10) || 5, 25);

        // Get player's score first
        const playerResult = await db.query(
            'SELECT high_score FROM game_progress WHERE player_id = $1 AND tenant_id = $2 AND game_id = $3',
            [playerId, tenantId, gameId]
        );

        if (playerResult.rows.length === 0) {
            return res.json({ gameId, entries: [] });
        }

        const playerScore = parseInt(playerResult.rows[0].high_score, 10);

        // Get players around this score
        const result = await db.query(`
            (SELECT gp.player_id, gp.high_score, gp.stars, gp.level,
                    p.display_name, p.avatar_character,
                    RANK() OVER (ORDER BY gp.high_score DESC) as rank
             FROM game_progress gp
             JOIN players p ON p.id = gp.player_id AND p.tenant_id = gp.tenant_id
             WHERE gp.tenant_id = $1 AND gp.game_id = $2 AND gp.high_score >= $3
             ORDER BY gp.high_score ASC
             LIMIT $4)
            UNION ALL
            (SELECT gp.player_id, gp.high_score, gp.stars, gp.level,
                    p.display_name, p.avatar_character,
                    RANK() OVER (ORDER BY gp.high_score DESC) as rank
             FROM game_progress gp
             JOIN players p ON p.id = gp.player_id AND p.tenant_id = gp.tenant_id
             WHERE gp.tenant_id = $1 AND gp.game_id = $2 AND gp.high_score < $3
             ORDER BY gp.high_score DESC
             LIMIT $4)
            ORDER BY high_score DESC
        `, [tenantId, gameId, playerScore, range]);

        res.json({
            gameId,
            entries: result.rows.map(row => ({
                playerId: row.player_id,
                displayName: row.display_name,
                avatarCharacter: row.avatar_character,
                highScore: parseInt(row.high_score, 10),
                stars: row.stars,
                level: row.level,
                isCurrentPlayer: row.player_id === playerId
            }))
        });
    } catch (err) {
        next(err);
    }
});

/**
 * Global leaderboard (aggregate total score across all games).
 */
router.get('/global', async (req, res, next) => {
    try {
        const tenantId = req.tenantId;
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
        const offset = parseInt(req.query.offset, 10) || 0;

        const cacheKey = `lb_result:${tenantId}:global:${offset}:${limit}`;
        const cached = await cache.get(cacheKey);
        if (cached) return res.json(cached);

        const result = await db.query(`
            SELECT p.id as player_id, p.display_name, p.avatar_character,
                   p.total_score, p.games_played,
                   RANK() OVER (ORDER BY p.total_score DESC) as rank
            FROM players p
            WHERE p.tenant_id = $1 AND p.total_score > 0
            ORDER BY p.total_score DESC
            LIMIT $2 OFFSET $3
        `, [tenantId, limit, offset]);

        const countResult = await db.query(
            'SELECT COUNT(*) FROM players WHERE tenant_id = $1 AND total_score > 0',
            [tenantId]
        );

        const response = {
            total: parseInt(countResult.rows[0].count, 10),
            offset,
            limit,
            entries: result.rows.map(row => ({
                rank: parseInt(row.rank, 10),
                playerId: row.player_id,
                displayName: row.display_name,
                avatarCharacter: row.avatar_character,
                totalScore: parseInt(row.total_score, 10),
                gamesPlayed: row.games_played
            }))
        };

        await cache.set(cacheKey, response, config.leaderboard.cacheSeconds);
        res.json(response);
    } catch (err) {
        next(err);
    }
});

// =========================================
// Friend Leaderboard
// =========================================

router.get('/:gameId/friends', async (req, res, next) => {
    try {
        if (!req.player) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { gameId } = req.params;
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;

        const result = await db.query(`
            SELECT gp.player_id, gp.high_score, gp.stars, gp.level, gp.play_count,
                   p.display_name, p.avatar_character,
                   RANK() OVER (ORDER BY gp.high_score DESC) as rank
            FROM game_progress gp
            JOIN players p ON p.id = gp.player_id AND p.tenant_id = gp.tenant_id
            WHERE gp.tenant_id = $1 AND gp.game_id = $2 AND gp.high_score > 0
                AND (gp.player_id = $3 OR gp.player_id IN (
                    SELECT CASE WHEN f.player_id = $3 THEN f.friend_id ELSE f.player_id END
                    FROM friendships f
                    WHERE f.tenant_id = $1 AND f.status = 'accepted'
                        AND (f.player_id = $3 OR f.friend_id = $3)
                ))
            ORDER BY gp.high_score DESC
            LIMIT 50
        `, [tenantId, gameId, playerId]);

        res.json({
            gameId,
            entries: result.rows.map(row => ({
                rank: parseInt(row.rank, 10),
                playerId: row.player_id,
                displayName: row.display_name,
                avatarCharacter: row.avatar_character,
                highScore: parseInt(row.high_score, 10),
                stars: row.stars,
                isCurrentPlayer: row.player_id === playerId
            }))
        });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Ranked / Season Multiplayer Leaderboard
// =========================================

router.get('/:gameId/ranked', async (req, res, next) => {
    try {
        const { gameId } = req.params;
        const tenantId = req.player?.tenantId || req.tenantId || 'stem_default';
        const region = req.query.region || 'global';
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
        const offset = parseInt(req.query.offset, 10) || 0;

        // Get current season
        const activeSeason = await db.query(
            'SELECT id, name FROM seasons WHERE tenant_id = $1 AND is_active = TRUE ORDER BY starts_at DESC LIMIT 1',
            [tenantId]
        );
        const seasonId = activeSeason.rows[0]?.id || null;

        const cacheKey = `lb_ranked:${tenantId}:${gameId}:${region}:${seasonId}:${offset}:${limit}`;
        const cached = await cache.get(cacheKey);
        if (cached) return res.json(cached);

        let query, params;
        if (seasonId) {
            query = `
                SELECT le.player_id, le.score, le.wins, le.losses, le.draws,
                       le.matches_played, le.skill_rating,
                       p.display_name, p.avatar_character,
                       ROW_NUMBER() OVER (ORDER BY le.skill_rating DESC, le.score DESC) as rank
                FROM leaderboard_entries le
                JOIN players p ON p.id = le.player_id AND p.tenant_id = le.tenant_id
                WHERE le.tenant_id = $1 AND le.game_id = $2
                    AND le.region = $3 AND le.season_id = $4
                ORDER BY le.skill_rating DESC, le.score DESC
                LIMIT $5 OFFSET $6
            `;
            params = [tenantId, gameId, region, seasonId, limit, offset];
        } else {
            query = `
                SELECT le.player_id, le.score, le.wins, le.losses, le.draws,
                       le.matches_played, le.skill_rating,
                       p.display_name, p.avatar_character,
                       ROW_NUMBER() OVER (ORDER BY le.skill_rating DESC, le.score DESC) as rank
                FROM leaderboard_entries le
                JOIN players p ON p.id = le.player_id AND p.tenant_id = le.tenant_id
                WHERE le.tenant_id = $1 AND le.game_id = $2
                    AND le.region = $3 AND le.season_id IS NULL
                ORDER BY le.skill_rating DESC, le.score DESC
                LIMIT $4 OFFSET $5
            `;
            params = [tenantId, gameId, region, limit, offset];
        }

        const result = await db.query(query, params);

        const response = {
            gameId,
            region,
            seasonId,
            seasonName: activeSeason.rows[0]?.name || null,
            offset,
            limit,
            entries: result.rows.map(row => ({
                rank: parseInt(row.rank, 10),
                playerId: row.player_id,
                displayName: row.display_name,
                avatarCharacter: row.avatar_character,
                score: parseInt(row.score, 10),
                skillRating: row.skill_rating,
                wins: row.wins,
                losses: row.losses,
                draws: row.draws,
                matchesPlayed: row.matches_played
            }))
        };

        await cache.set(cacheKey, response, 15); // shorter cache for ranked
        res.json(response);
    } catch (err) {
        next(err);
    }
});

// =========================================
// Seasons
// =========================================

router.get('/seasons', async (req, res, next) => {
    try {
        const tenantId = req.player?.tenantId || req.tenantId || 'stem_default';
        const result = await db.query(
            'SELECT * FROM seasons WHERE tenant_id = $1 ORDER BY starts_at DESC LIMIT 20',
            [tenantId]
        );
        res.json({ seasons: result.rows });
    } catch (err) {
        next(err);
    }
});

router.get('/seasons/current', async (req, res, next) => {
    try {
        const tenantId = req.player?.tenantId || req.tenantId || 'stem_default';
        const result = await db.query(
            'SELECT * FROM seasons WHERE tenant_id = $1 AND is_active = TRUE ORDER BY starts_at DESC LIMIT 1',
            [tenantId]
        );
        res.json({ season: result.rows[0] || null });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Submit Multiplayer Match Result
// =========================================

router.post('/submit-match', async (req, res, next) => {
    try {
        if (!req.player) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const tenantId = req.player.tenantId;
        const { gameId, matchId, results, ratingChanges } = req.body;

        if (!gameId || !results || !Array.isArray(results)) {
            return res.status(400).json({ error: 'gameId and results array required' });
        }

        // Get current season
        const activeSeason = await db.query(
            'SELECT id FROM seasons WHERE tenant_id = $1 AND is_active = TRUE LIMIT 1',
            [tenantId]
        );
        const seasonId = activeSeason.rows[0]?.id || null;

        for (const result of results) {
            const isWin = result.isWinner;
            const isLoss = !isWin && results.length > 1;
            const isDraw = !isWin && results.filter(r => r.placement === result.placement).length > 1;
            const newRating = ratingChanges?.[result.id]?.newRating || null;

            // Upsert global leaderboard entry
            await db.query(`
                INSERT INTO leaderboard_entries
                    (tenant_id, player_id, game_id, season_id, region, score, wins, losses, draws, matches_played, skill_rating)
                VALUES ($1, $2, $3, $4, 'global', $5, $6, $7, $8, 1, COALESCE($9, 1000))
                ON CONFLICT (tenant_id, player_id, game_id, season_id, region)
                DO UPDATE SET
                    score = leaderboard_entries.score + EXCLUDED.score,
                    wins = leaderboard_entries.wins + EXCLUDED.wins,
                    losses = leaderboard_entries.losses + EXCLUDED.losses,
                    draws = leaderboard_entries.draws + EXCLUDED.draws,
                    matches_played = leaderboard_entries.matches_played + 1,
                    skill_rating = COALESCE($9, leaderboard_entries.skill_rating),
                    updated_at = NOW()
            `, [tenantId, result.id, gameId, seasonId,
                result.score || 0, isWin ? 1 : 0, isLoss ? 1 : 0, isDraw ? 1 : 0,
                newRating]);

            // Upsert regional entry
            const playerRegion = await db.query(
                'SELECT region FROM players WHERE id = $1 AND tenant_id = $2',
                [result.id, tenantId]
            );
            const region = playerRegion.rows[0]?.region || 'us-east';

            await db.query(`
                INSERT INTO leaderboard_entries
                    (tenant_id, player_id, game_id, season_id, region, score, wins, losses, draws, matches_played, skill_rating)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, COALESCE($10, 1000))
                ON CONFLICT (tenant_id, player_id, game_id, season_id, region)
                DO UPDATE SET
                    score = leaderboard_entries.score + EXCLUDED.score,
                    wins = leaderboard_entries.wins + EXCLUDED.wins,
                    losses = leaderboard_entries.losses + EXCLUDED.losses,
                    draws = leaderboard_entries.draws + EXCLUDED.draws,
                    matches_played = leaderboard_entries.matches_played + 1,
                    skill_rating = COALESCE($10, leaderboard_entries.skill_rating),
                    updated_at = NOW()
            `, [tenantId, result.id, gameId, seasonId, region,
                result.score || 0, isWin ? 1 : 0, isLoss ? 1 : 0, isDraw ? 1 : 0,
                newRating]);

            // Update player aggregate stats
            await db.query(`
                UPDATE players SET
                    mp_wins = mp_wins + $1, mp_losses = mp_losses + $2,
                    mp_draws = mp_draws + $3, mp_matches = mp_matches + 1,
                    skill_rating = COALESCE($4, skill_rating)
                WHERE id = $5 AND tenant_id = $6
            `, [isWin ? 1 : 0, isLoss ? 1 : 0, isDraw ? 1 : 0, newRating, result.id, tenantId]);
        }

        res.json({ message: 'Match results submitted', seasonId });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Helpers
// =========================================

function _getPeriodFilter(period) {
    const now = new Date();
    switch (period) {
        case 'daily':
            now.setHours(0, 0, 0, 0);
            return now.toISOString();
        case 'weekly':
            now.setDate(now.getDate() - now.getDay());
            now.setHours(0, 0, 0, 0);
            return now.toISOString();
        case 'monthly':
            now.setDate(1);
            now.setHours(0, 0, 0, 0);
            return now.toISOString();
        default:
            return '1970-01-01T00:00:00.000Z';
    }
}

module.exports = router;
