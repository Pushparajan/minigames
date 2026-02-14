/**
 * Friend System Routes
 * =====================
 * Social features: friend requests, friend lists, online presence,
 * game invites, and blocking.
 *
 * Routes:
 *   GET    /friends              — List friends (accepted)
 *   GET    /friends/requests     — Pending friend requests
 *   GET    /friends/online       — Online friends
 *   POST   /friends/request      — Send friend request
 *   POST   /friends/:id/accept   — Accept a friend request
 *   POST   /friends/:id/decline  — Decline a friend request
 *   POST   /friends/:id/remove   — Remove a friend
 *   POST   /friends/:id/block    — Block a player
 *   POST   /friends/:id/unblock  — Unblock a player
 *   GET    /friends/blocked       — List blocked players
 *   POST   /friends/:id/invite   — Invite friend to a game room
 *   GET    /friends/search       — Search for players by name
 */

const express = require('express');
const db = require('../models/db');

const router = express.Router();

// =========================================
// List Friends
// =========================================

router.get('/', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;

        const result = await db.query(`
            SELECT p.id, p.display_name, p.avatar_character,
                   pp.status as presence_status, pp.current_game_id,
                   f.created_at as friends_since
            FROM friendships f
            JOIN players p ON (
                CASE WHEN f.player_id = $1 THEN p.id = f.friend_id
                     ELSE p.id = f.player_id END
            )
            LEFT JOIN player_presence pp ON pp.player_id = p.id
            WHERE f.tenant_id = $2
                AND (f.player_id = $1 OR f.friend_id = $1)
                AND f.status = 'accepted'
            ORDER BY pp.status = 'online' DESC, p.display_name ASC
        `, [playerId, tenantId]);

        res.json({ friends: result.rows });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Pending Friend Requests
// =========================================

router.get('/requests', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;

        const [incoming, outgoing] = await Promise.all([
            db.query(`
                SELECT f.id, f.player_id as from_id, p.display_name as from_name,
                       p.avatar_character, f.created_at
                FROM friendships f
                JOIN players p ON p.id = f.player_id AND p.tenant_id = f.tenant_id
                WHERE f.friend_id = $1 AND f.tenant_id = $2 AND f.status = 'pending'
                ORDER BY f.created_at DESC
            `, [playerId, tenantId]),
            db.query(`
                SELECT f.id, f.friend_id as to_id, p.display_name as to_name,
                       p.avatar_character, f.created_at
                FROM friendships f
                JOIN players p ON p.id = f.friend_id AND p.tenant_id = f.tenant_id
                WHERE f.player_id = $1 AND f.tenant_id = $2 AND f.status = 'pending'
                ORDER BY f.created_at DESC
            `, [playerId, tenantId])
        ]);

        res.json({
            incoming: incoming.rows,
            outgoing: outgoing.rows
        });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Online Friends
// =========================================

router.get('/online', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;

        const result = await db.query(`
            SELECT p.id, p.display_name, p.avatar_character,
                   pp.status as presence_status, pp.current_game_id, pp.current_room_id
            FROM friendships f
            JOIN players p ON (
                CASE WHEN f.player_id = $1 THEN p.id = f.friend_id
                     ELSE p.id = f.player_id END
            )
            JOIN player_presence pp ON pp.player_id = p.id AND pp.status != 'offline'
            WHERE f.tenant_id = $2
                AND (f.player_id = $1 OR f.friend_id = $1)
                AND f.status = 'accepted'
            ORDER BY pp.status ASC, p.display_name ASC
        `, [playerId, tenantId]);

        res.json({ online: result.rows });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Send Friend Request
// =========================================

router.post('/request', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const { friendId } = req.body;

        if (!friendId) {
            return res.status(400).json({ error: 'friendId is required' });
        }

        if (friendId === playerId) {
            return res.status(400).json({ error: 'Cannot friend yourself' });
        }

        // Check target player exists
        const target = await db.query(
            'SELECT id FROM players WHERE id = $1 AND tenant_id = $2',
            [friendId, tenantId]
        );
        if (target.rows.length === 0) {
            return res.status(404).json({ error: 'Player not found' });
        }

        // Check for existing relationship
        const existing = await db.query(`
            SELECT id, status FROM friendships
            WHERE tenant_id = $1
                AND ((player_id = $2 AND friend_id = $3) OR (player_id = $3 AND friend_id = $2))
        `, [tenantId, playerId, friendId]);

        if (existing.rows.length > 0) {
            const rel = existing.rows[0];
            if (rel.status === 'accepted') {
                return res.status(409).json({ error: 'Already friends' });
            }
            if (rel.status === 'pending') {
                return res.status(409).json({ error: 'Friend request already pending' });
            }
            if (rel.status === 'blocked') {
                return res.status(403).json({ error: 'Cannot send friend request' });
            }
        }

        const result = await db.query(`
            INSERT INTO friendships (tenant_id, player_id, friend_id, status)
            VALUES ($1, $2, $3, 'pending')
            RETURNING id, status, created_at
        `, [tenantId, playerId, friendId]);

        res.status(201).json({
            message: 'Friend request sent',
            request: result.rows[0]
        });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Accept Friend Request
// =========================================

router.post('/:id/accept', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const friendshipId = req.params.id;

        const result = await db.query(`
            UPDATE friendships SET status = 'accepted', updated_at = NOW()
            WHERE id = $1 AND friend_id = $2 AND tenant_id = $3 AND status = 'pending'
            RETURNING id, player_id, friend_id, status
        `, [friendshipId, playerId, tenantId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Friend request not found' });
        }

        res.json({ message: 'Friend request accepted', friendship: result.rows[0] });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Decline Friend Request
// =========================================

router.post('/:id/decline', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const friendshipId = req.params.id;

        const result = await db.query(
            'DELETE FROM friendships WHERE id = $1 AND friend_id = $2 AND tenant_id = $3 AND status = $4 RETURNING id',
            [friendshipId, playerId, tenantId, 'pending']
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Friend request not found' });
        }

        res.json({ message: 'Friend request declined' });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Remove Friend
// =========================================

router.post('/:id/remove', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const friendId = req.params.id;

        const result = await db.query(`
            DELETE FROM friendships
            WHERE tenant_id = $1 AND status = 'accepted'
                AND ((player_id = $2 AND friend_id = $3) OR (player_id = $3 AND friend_id = $2))
            RETURNING id
        `, [tenantId, playerId, friendId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Friendship not found' });
        }

        res.json({ message: 'Friend removed' });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Block / Unblock
// =========================================

router.post('/:id/block', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const targetId = req.params.id;

        // Remove any existing friendship first
        await db.query(`
            DELETE FROM friendships
            WHERE tenant_id = $1
                AND ((player_id = $2 AND friend_id = $3) OR (player_id = $3 AND friend_id = $2))
        `, [tenantId, playerId, targetId]);

        // Create block entry
        await db.query(`
            INSERT INTO friendships (tenant_id, player_id, friend_id, status)
            VALUES ($1, $2, $3, 'blocked')
            ON CONFLICT (tenant_id, player_id, friend_id) DO UPDATE SET status = 'blocked', updated_at = NOW()
        `, [tenantId, playerId, targetId]);

        res.json({ message: 'Player blocked' });
    } catch (err) {
        next(err);
    }
});

router.post('/:id/unblock', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const targetId = req.params.id;

        await db.query(`
            DELETE FROM friendships
            WHERE tenant_id = $1 AND player_id = $2 AND friend_id = $3 AND status = 'blocked'
        `, [tenantId, playerId, targetId]);

        res.json({ message: 'Player unblocked' });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Blocked List
// =========================================

router.get('/blocked', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;

        const result = await db.query(`
            SELECT p.id, p.display_name, p.avatar_character, f.created_at as blocked_at
            FROM friendships f
            JOIN players p ON p.id = f.friend_id AND p.tenant_id = f.tenant_id
            WHERE f.player_id = $1 AND f.tenant_id = $2 AND f.status = 'blocked'
            ORDER BY f.created_at DESC
        `, [playerId, tenantId]);

        res.json({ blocked: result.rows });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Invite Friend to Game
// =========================================

router.post('/:id/invite', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const friendId = req.params.id;
        const { roomId, gameId } = req.body;

        if (!roomId || !gameId) {
            return res.status(400).json({ error: 'roomId and gameId required' });
        }

        // Verify friendship
        const friendship = await db.query(`
            SELECT id FROM friendships
            WHERE tenant_id = $1 AND status = 'accepted'
                AND ((player_id = $2 AND friend_id = $3) OR (player_id = $3 AND friend_id = $2))
        `, [tenantId, playerId, friendId]);

        if (friendship.rows.length === 0) {
            return res.status(403).json({ error: 'Not friends with this player' });
        }

        // The invite will be delivered via WebSocket; just return success
        // (the caller handles WS delivery)
        res.json({
            message: 'Invite sent',
            invite: {
                from: playerId,
                to: friendId,
                roomId,
                gameId,
                createdAt: new Date().toISOString()
            }
        });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Search Players
// =========================================

router.get('/search', async (req, res, next) => {
    try {
        const tenantId = req.player.tenantId;
        const playerId = req.player.id;
        const q = req.query.q || '';
        const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

        if (q.length < 2) {
            return res.status(400).json({ error: 'Search query must be at least 2 characters' });
        }

        const result = await db.query(`
            SELECT p.id, p.display_name, p.avatar_character,
                   pp.status as presence_status,
                   (SELECT status FROM friendships f
                    WHERE f.tenant_id = $1
                        AND ((f.player_id = $2 AND f.friend_id = p.id) OR (f.player_id = p.id AND f.friend_id = $2))
                    LIMIT 1) as friendship_status
            FROM players p
            LEFT JOIN player_presence pp ON pp.player_id = p.id
            WHERE p.tenant_id = $1 AND p.id != $2
                AND p.display_name ILIKE $3
            ORDER BY p.display_name ASC
            LIMIT $4
        `, [tenantId, playerId, `%${q}%`, limit]);

        res.json({ players: result.rows });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
