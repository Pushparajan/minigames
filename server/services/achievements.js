/**
 * Achievement Service
 * ====================
 * Evaluates achievement criteria after score submissions
 * and awards badges to players.
 */

const db = require('../models/db');

/**
 * Check and award achievements for a player after a game action.
 *
 * @param {string} playerId
 * @param {string} tenantId
 * @returns {Array} Newly awarded achievement IDs
 */
async function evaluate(playerId, tenantId) {
    const awarded = [];

    // Fetch player stats
    const playerResult = await db.query(
        'SELECT total_score, games_played FROM players WHERE id = $1 AND tenant_id = $2',
        [playerId, tenantId]
    );
    if (playerResult.rows.length === 0) return awarded;
    const player = playerResult.rows[0];

    // Fetch progress stats
    const progressResult = await db.query(`
        SELECT
            COUNT(*) FILTER (WHERE play_count > 0) as unique_games,
            COUNT(*) FILTER (WHERE stars = 3) as three_star_games
        FROM game_progress
        WHERE player_id = $1 AND tenant_id = $2
    `, [playerId, tenantId]);
    const stats = progressResult.rows[0];

    // Fetch already earned achievements
    const earnedResult = await db.query(
        'SELECT achievement_id FROM player_achievements WHERE player_id = $1 AND tenant_id = $2',
        [playerId, tenantId]
    );
    const earned = new Set(earnedResult.rows.map(r => r.achievement_id));

    // Fetch achievement definitions
    const defsResult = await db.query(
        'SELECT * FROM achievements WHERE tenant_id = $1',
        [tenantId]
    );

    for (const def of defsResult.rows) {
        if (earned.has(def.id)) continue;

        const criteria = def.criteria_json;
        let met = false;

        switch (criteria.type) {
            case 'games_played':
                met = parseInt(player.games_played, 10) >= criteria.threshold;
                break;
            case 'total_score':
                met = parseInt(player.total_score, 10) >= criteria.threshold;
                break;
            case 'unique_games':
                met = parseInt(stats.unique_games, 10) >= criteria.threshold;
                break;
            case 'all_three_stars':
                met = parseInt(stats.three_star_games, 10) >= criteria.threshold;
                break;
        }

        if (met) {
            await db.query(
                'INSERT INTO player_achievements (player_id, tenant_id, achievement_id, game_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
                [playerId, tenantId, def.id, def.game_id]
            );
            awarded.push(def.id);
        }
    }

    return awarded;
}

module.exports = { evaluate };
