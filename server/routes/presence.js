/**
 * Player Presence Routes
 * ========================
 * Real-time presence tracking for online status,
 * current game, and activity state.
 *
 * Routes:
 *   GET    /presence/me        — Get own presence
 *   POST   /presence/update    — Update presence state
 *   POST   /presence/heartbeat — Heartbeat to stay online
 *   GET    /presence/:id       — Get another player's presence
 */

const express = require('express');
const db = require('../models/db');

const router = express.Router();

// =========================================
// Get Own Presence
// =========================================

router.get('/me', async (req, res, next) => {
    try {
        const playerId = req.player.id;

        const result = await db.query(
            'SELECT * FROM player_presence WHERE player_id = $1',
            [playerId]
        );

        if (result.rows.length === 0) {
            return res.json({ presence: { status: 'offline', playerId } });
        }

        res.json({ presence: result.rows[0] });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Update Presence
// =========================================

router.post('/update', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const { status, currentGameId, currentRoomId } = req.body;

        const validStatuses = ['online', 'in_game', 'in_lobby', 'away'];
        if (status && !validStatuses.includes(status)) {
            return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
        }

        await db.query(`
            INSERT INTO player_presence (player_id, tenant_id, status, current_game_id, current_room_id, last_seen_at, connected_at, server_node)
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), $6)
            ON CONFLICT (player_id) DO UPDATE SET
                status = COALESCE($3, player_presence.status),
                current_game_id = $4,
                current_room_id = $5,
                last_seen_at = NOW(),
                server_node = $6
        `, [playerId, tenantId, status || 'online', currentGameId || null, currentRoomId || null,
            process.env.NODE_ID || `node-${process.pid}`]);

        res.json({ message: 'Presence updated' });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Heartbeat
// =========================================

router.post('/heartbeat', async (req, res, next) => {
    try {
        const playerId = req.player.id;

        await db.query(`
            UPDATE player_presence SET last_seen_at = NOW()
            WHERE player_id = $1
        `, [playerId]);

        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Get Player Presence
// =========================================

router.get('/:id', async (req, res, next) => {
    try {
        const targetId = req.params.id;

        const result = await db.query(
            'SELECT player_id, status, current_game_id, last_seen_at FROM player_presence WHERE player_id = $1',
            [targetId]
        );

        if (result.rows.length === 0) {
            return res.json({ presence: { playerId: targetId, status: 'offline' } });
        }

        // Mark as offline if last seen > 5 minutes ago
        const lastSeen = new Date(result.rows[0].last_seen_at);
        const fiveMinAgo = Date.now() - 300000;
        if (lastSeen.getTime() < fiveMinAgo) {
            result.rows[0].status = 'offline';
        }

        res.json({ presence: result.rows[0] });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
