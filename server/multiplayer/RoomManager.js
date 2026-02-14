/**
 * RoomManager.js
 * ================
 * Manages multiplayer game rooms: creation, joining, leaving,
 * matchmaking, and room lifecycle. Uses Redis for shared state
 * so multiple server instances can coordinate.
 */

const { v4: uuidv4 } = require('uuid');
const cache = require('../services/cache');

/** In-memory room state (authoritative for this server instance) */
const _rooms = new Map();

/** Player-to-room mapping */
const _playerRooms = new Map();

const MAX_ROOM_SIZE = 8;
const ROOM_TTL = 3600; // 1 hour
const MATCHMAKING_TIMEOUT = 30000; // 30 seconds

/**
 * Room states: waiting → playing → finished
 */

/**
 * Create a new game room.
 */
function createRoom(hostPlayer, options = {}) {
    const roomId = uuidv4().slice(0, 8);
    const room = {
        id: roomId,
        gameId: options.gameId || null,
        name: options.name || `${hostPlayer.displayName}'s Game`,
        hostId: hostPlayer.id,
        maxPlayers: Math.min(options.maxPlayers || 2, MAX_ROOM_SIZE),
        isPrivate: !!options.isPrivate,
        state: 'waiting',
        players: [{
            id: hostPlayer.id,
            displayName: hostPlayer.displayName,
            avatar: hostPlayer.avatar || 'guha',
            isHost: true,
            isReady: false,
            ws: null
        }],
        gameState: {},
        createdAt: Date.now(),
        startedAt: null
    };

    _rooms.set(roomId, room);
    _playerRooms.set(hostPlayer.id, roomId);
    _syncRoomToRedis(room);

    return _sanitizeRoom(room);
}

/**
 * Join an existing room.
 */
function joinRoom(roomId, player) {
    const room = _rooms.get(roomId);
    if (!room) return { error: 'Room not found' };
    if (room.state !== 'waiting') return { error: 'Game already in progress' };
    if (room.players.length >= room.maxPlayers) return { error: 'Room is full' };
    if (room.players.find(p => p.id === player.id)) return { error: 'Already in this room' };

    // Leave any existing room first
    const existingRoom = _playerRooms.get(player.id);
    if (existingRoom) leaveRoom(existingRoom, player.id);

    room.players.push({
        id: player.id,
        displayName: player.displayName,
        avatar: player.avatar || 'guha',
        isHost: false,
        isReady: false,
        ws: null
    });

    _playerRooms.set(player.id, roomId);
    _syncRoomToRedis(room);

    return { room: _sanitizeRoom(room) };
}

/**
 * Leave a room. If the host leaves, transfer to next player or close room.
 */
function leaveRoom(roomId, playerId) {
    const room = _rooms.get(roomId);
    if (!room) return;

    room.players = room.players.filter(p => p.id !== playerId);
    _playerRooms.delete(playerId);

    if (room.players.length === 0) {
        _rooms.delete(roomId);
        _removeRoomFromRedis(roomId);
        return { closed: true };
    }

    // Transfer host if the host left
    if (room.hostId === playerId) {
        room.hostId = room.players[0].id;
        room.players[0].isHost = true;
    }

    _syncRoomToRedis(room);
    return { room: _sanitizeRoom(room) };
}

/**
 * Set a player's ready state.
 */
function setReady(roomId, playerId, ready) {
    const room = _rooms.get(roomId);
    if (!room) return null;

    const player = room.players.find(p => p.id === playerId);
    if (player) player.isReady = ready;

    _syncRoomToRedis(room);
    return _sanitizeRoom(room);
}

/**
 * Start the game (host only).
 */
function startGame(roomId, playerId) {
    const room = _rooms.get(roomId);
    if (!room) return { error: 'Room not found' };
    if (room.hostId !== playerId) return { error: 'Only the host can start' };
    if (room.players.length < 2) return { error: 'Need at least 2 players' };
    if (room.state !== 'waiting') return { error: 'Game already started' };

    // Check all non-host players are ready
    const notReady = room.players.filter(p => !p.isHost && !p.isReady);
    if (notReady.length > 0) return { error: 'Not all players are ready' };

    room.state = 'playing';
    room.startedAt = Date.now();
    room.gameState = _initGameState(room);

    _syncRoomToRedis(room);
    return { room: _sanitizeRoom(room), gameState: room.gameState };
}

/**
 * Process a game action from a player.
 */
function processAction(roomId, playerId, action) {
    const room = _rooms.get(roomId);
    if (!room || room.state !== 'playing') return null;

    const playerIndex = room.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return null;

    // Apply action to game state
    const result = _applyAction(room, playerIndex, action);
    _syncRoomToRedis(room);
    return result;
}

/**
 * End the game and record results.
 */
function endGame(roomId, results) {
    const room = _rooms.get(roomId);
    if (!room) return;

    room.state = 'finished';
    room.gameState.results = results;
    _syncRoomToRedis(room);

    // Auto-cleanup after 60 seconds
    setTimeout(() => {
        _rooms.delete(roomId);
        room.players.forEach(p => _playerRooms.delete(p.id));
        _removeRoomFromRedis(roomId);
    }, 60000);

    return _sanitizeRoom(room);
}

/**
 * Quick matchmaking: find or create a room for a game.
 */
function findMatch(player, gameId) {
    // Find an open public room for this game
    for (const [, room] of _rooms) {
        if (room.gameId === gameId &&
            room.state === 'waiting' &&
            !room.isPrivate &&
            room.players.length < room.maxPlayers) {
            return joinRoom(room.id, player);
        }
    }

    // No room found — create one
    const room = createRoom(player, { gameId, name: `${gameId} Match`, maxPlayers: 2 });
    return { room, waiting: true };
}

/**
 * List public rooms (for lobby browsing).
 */
function listRooms(options = {}) {
    const rooms = [];
    for (const [, room] of _rooms) {
        if (room.isPrivate) continue;
        if (options.gameId && room.gameId !== options.gameId) continue;
        if (options.state && room.state !== options.state) continue;
        rooms.push(_sanitizeRoom(room));
    }
    return rooms.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Get a room by ID.
 */
function getRoom(roomId) {
    const room = _rooms.get(roomId);
    return room ? _sanitizeRoom(room) : null;
}

/**
 * Get the room a player is currently in.
 */
function getPlayerRoom(playerId) {
    const roomId = _playerRooms.get(playerId);
    if (!roomId) return null;
    return getRoom(roomId);
}

/**
 * Get the raw room (with ws refs) — internal use only.
 */
function _getRoomInternal(roomId) {
    return _rooms.get(roomId) || null;
}

/**
 * Attach a WebSocket to a player in a room.
 */
function setPlayerWs(roomId, playerId, ws) {
    const room = _rooms.get(roomId);
    if (!room) return;
    const player = room.players.find(p => p.id === playerId);
    if (player) player.ws = ws;
}

/**
 * Broadcast a message to all players in a room (except sender).
 */
function broadcast(roomId, message, excludePlayerId) {
    const room = _rooms.get(roomId);
    if (!room) return;

    const data = JSON.stringify(message);
    room.players.forEach(p => {
        if (p.id !== excludePlayerId && p.ws && p.ws.readyState === 1) {
            p.ws.send(data);
        }
    });
}

/**
 * Broadcast to ALL players including sender.
 */
function broadcastAll(roomId, message) {
    const room = _rooms.get(roomId);
    if (!room) return;

    const data = JSON.stringify(message);
    room.players.forEach(p => {
        if (p.ws && p.ws.readyState === 1) {
            p.ws.send(data);
        }
    });
}

// =========================================
// Game State Helpers
// =========================================

function _initGameState(room) {
    return {
        turnIndex: 0,
        scores: room.players.map(() => 0),
        round: 1,
        maxRounds: 10,
        actions: [],
        startedAt: Date.now()
    };
}

function _applyAction(room, playerIndex, action) {
    const gs = room.gameState;

    switch (action.type) {
        case 'move':
            // Position update
            return { type: 'player_moved', playerIndex, data: action.data };

        case 'shoot':
        case 'action':
            // Game-specific action
            gs.actions.push({
                playerIndex,
                type: action.type,
                data: action.data,
                timestamp: Date.now()
            });
            return { type: 'player_action', playerIndex, action };

        case 'score':
            // Score update
            gs.scores[playerIndex] = (gs.scores[playerIndex] || 0) + (action.points || 0);
            return { type: 'score_update', scores: [...gs.scores] };

        case 'end_turn':
            gs.turnIndex = (gs.turnIndex + 1) % room.players.length;
            if (gs.turnIndex === 0) gs.round++;
            if (gs.round > gs.maxRounds) {
                room.state = 'finished';
                return { type: 'game_over', scores: [...gs.scores] };
            }
            return { type: 'turn_change', turnIndex: gs.turnIndex, round: gs.round };

        default:
            return { type: 'custom', playerIndex, action };
    }
}

// =========================================
// Redis Sync (for multi-instance)
// =========================================

async function _syncRoomToRedis(room) {
    try {
        const data = { ...room, players: room.players.map(p => ({ ...p, ws: undefined })) };
        await cache.set(`room:${room.id}`, JSON.stringify(data), ROOM_TTL);
    } catch (e) {
        // Redis may not be available — rooms still work in-memory
    }
}

async function _removeRoomFromRedis(roomId) {
    try {
        await cache.del(`room:${roomId}`);
    } catch (e) { /* ignore */ }
}

// =========================================
// Cleanup stale rooms
// =========================================

setInterval(() => {
    const now = Date.now();
    for (const [id, room] of _rooms) {
        const age = now - room.createdAt;
        if (age > ROOM_TTL * 1000) {
            room.players.forEach(p => _playerRooms.delete(p.id));
            _rooms.delete(id);
            _removeRoomFromRedis(id);
        }
    }
}, 60000);

// =========================================
// Sanitize for client (strip ws refs)
// =========================================

function _sanitizeRoom(room) {
    return {
        id: room.id,
        gameId: room.gameId,
        name: room.name,
        hostId: room.hostId,
        maxPlayers: room.maxPlayers,
        isPrivate: room.isPrivate,
        state: room.state,
        playerCount: room.players.length,
        players: room.players.map(p => ({
            id: p.id,
            displayName: p.displayName,
            avatar: p.avatar,
            isHost: p.isHost,
            isReady: p.isReady
        })),
        createdAt: room.createdAt,
        startedAt: room.startedAt
    };
}

module.exports = {
    createRoom,
    joinRoom,
    leaveRoom,
    setReady,
    startGame,
    processAction,
    endGame,
    findMatch,
    listRooms,
    getRoom,
    getPlayerRoom,
    setPlayerWs,
    broadcast,
    broadcastAll,
    _getRoomInternal
};
