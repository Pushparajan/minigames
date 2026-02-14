/**
 * Multiplayer REST Routes
 * ========================
 * REST endpoints for room management and lobby browsing.
 * Real-time game communication uses WebSockets (/ws),
 * but these routes handle room CRUD and matchmaking setup.
 *
 * GET  /multiplayer/rooms          — List public rooms
 * POST /multiplayer/rooms          — Create a new room
 * GET  /multiplayer/rooms/:id      — Get room details
 * POST /multiplayer/rooms/:id/join — Join a room
 * POST /multiplayer/matchmake      — Quick matchmaking
 */

const express = require('express');
const rooms = require('../multiplayer/RoomManager');

const router = express.Router();

/**
 * List public rooms, optionally filtered by gameId or state.
 */
router.get('/rooms', (req, res) => {
    const { gameId, state } = req.query;
    const list = rooms.listRooms({
        gameId: gameId || undefined,
        state: state || 'waiting'
    });
    res.json({ rooms: list });
});

/**
 * Create a new game room.
 */
router.post('/rooms', (req, res) => {
    const player = {
        id: req.player.id,
        displayName: req.player.displayName || 'Player',
        avatar: req.player.avatarCharacter || 'guha'
    };

    const { gameId, name, maxPlayers, isPrivate } = req.body;

    if (!gameId) {
        return res.status(400).json({ error: 'gameId is required' });
    }

    const room = rooms.createRoom(player, { gameId, name, maxPlayers, isPrivate });
    res.status(201).json({ room });
});

/**
 * Get room details.
 */
router.get('/rooms/:id', (req, res) => {
    const room = rooms.getRoom(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({ room });
});

/**
 * Join a room via REST (also works via WebSocket).
 */
router.post('/rooms/:id/join', (req, res) => {
    const player = {
        id: req.player.id,
        displayName: req.player.displayName || 'Player',
        avatar: req.player.avatarCharacter || 'guha'
    };

    const result = rooms.joinRoom(req.params.id, player);
    if (result.error) {
        return res.status(400).json({ error: result.error });
    }
    res.json(result);
});

/**
 * Quick matchmaking — finds or creates a room for a game.
 */
router.post('/matchmake', (req, res) => {
    const player = {
        id: req.player.id,
        displayName: req.player.displayName || 'Player',
        avatar: req.player.avatarCharacter || 'guha'
    };

    const { gameId } = req.body;
    if (!gameId) {
        return res.status(400).json({ error: 'gameId is required' });
    }

    const result = rooms.findMatch(player, gameId);
    if (result.error) {
        return res.status(400).json({ error: result.error });
    }
    res.json(result);
});

/**
 * Get the current player's active room.
 */
router.get('/me', (req, res) => {
    const room = rooms.getPlayerRoom(req.player.id);
    res.json({ room });
});

module.exports = router;
