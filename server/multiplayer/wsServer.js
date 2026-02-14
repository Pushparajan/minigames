/**
 * WebSocket Server for Multiplayer
 * ==================================
 * Handles real-time communication for multiplayer games.
 * Authenticates connections via JWT token in the query string.
 * Manages player connections, room events, and game state sync.
 *
 * Protocol: JSON messages with { type, ...payload }
 *
 * Client → Server messages:
 *   { type: 'join_room', roomId }
 *   { type: 'leave_room' }
 *   { type: 'ready', ready: boolean }
 *   { type: 'start_game' }
 *   { type: 'game_action', action: { type, data } }
 *   { type: 'chat', message: string }
 *   { type: 'ping' }
 *
 * Server → Client messages:
 *   { type: 'connected', playerId }
 *   { type: 'room_update', room }
 *   { type: 'game_started', gameState }
 *   { type: 'game_action', playerIndex, action }
 *   { type: 'game_over', scores }
 *   { type: 'player_joined', player }
 *   { type: 'player_left', playerId }
 *   { type: 'chat', playerId, displayName, message }
 *   { type: 'error', message }
 *   { type: 'pong' }
 */

const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const config = require('../config');
const rooms = require('./RoomManager');
const { MatchmakingService } = require('./MatchmakingService');
const { AuthoritativeServer } = require('./AuthoritativeServer');
const { AntiCheatService } = require('./AntiCheatService');
const monitoring = require('../middleware/monitoring');

let _wss = null;

/** Map of playerId → ws connection */
const _connections = new Map();

/** Active authoritative game servers: roomId → AuthoritativeServer */
const _gameServers = new Map();

/** Matchmaking service singleton */
const matchmaking = new MatchmakingService();

/** Anti-cheat service singleton */
const antiCheat = new AntiCheatService();

/**
 * Attach the WebSocket server to an HTTP server.
 */
function attach(httpServer) {
    _wss = new WebSocketServer({
        server: httpServer,
        path: '/ws',
        maxPayload: 64 * 1024 // 64KB max message
    });

    _wss.on('connection', (ws, req) => {
        _handleConnection(ws, req);
    });

    // Start matchmaking service
    matchmaking.start((matchData) => {
        _onMatchFound(matchData);
    });

    // Update monitoring metrics every 5s
    setInterval(() => {
        monitoring.setWsConnections(_connections.size);
        monitoring.setCcu(_connections.size);
        monitoring.setActiveRooms(rooms.listRooms({}).length || 0);
        monitoring.setMatchmakingQueue(matchmaking.getStats().totalQueued);
    }, 5000);

    console.log('Multiplayer WebSocket server attached on /ws');
    return _wss;
}

/**
 * Handle a match found from the matchmaking service.
 */
function _onMatchFound(matchData) {
    // Create a room for the matched players
    const hostPlayer = matchData.players[0];
    const room = rooms.createRoom(hostPlayer, {
        gameId: matchData.gameId,
        name: `Ranked ${matchData.gameId}`,
        maxPlayers: matchData.players.length,
        isPrivate: true
    });

    if (!room || room.error) return;

    // Join all players to the room
    for (let i = 1; i < matchData.players.length; i++) {
        rooms.joinRoom(room.room.id, matchData.players[i]);
    }

    // Notify all matched players
    for (const player of matchData.players) {
        const ws = _connections.get(player.id);
        if (ws && ws.readyState === 1) {
            rooms.setPlayerWs(room.room.id, player.id, ws);
            ws._roomId = room.room.id;
            ws.send(JSON.stringify({
                type: 'match_found',
                matchId: matchData.matchId,
                room: rooms.getRoom(room.room.id),
                players: matchData.players.map(p => ({
                    id: p.id,
                    displayName: p.displayName,
                    skillRating: p.skillRating,
                    region: p.region
                }))
            }));
        }
    }
}

/**
 * Handle a new WebSocket connection.
 */
function _handleConnection(ws, req) {
    // Authenticate via token in query string
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
        ws.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
        ws.close(4001, 'No token');
        return;
    }

    let player;
    try {
        const decoded = jwt.verify(token, config.jwt.secret);
        player = {
            id: decoded.playerId || decoded.id,
            displayName: decoded.displayName || 'Player',
            avatar: decoded.avatar || 'guha',
            tenantId: decoded.tenantId
        };
    } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
        ws.close(4001, 'Invalid token');
        return;
    }

    // Close any existing connection for this player
    const existing = _connections.get(player.id);
    if (existing && existing.readyState <= 1) {
        existing.close(4000, 'Replaced by new connection');
    }

    _connections.set(player.id, ws);
    ws._playerId = player.id;
    ws._player = player;

    // Send connected confirmation
    ws.send(JSON.stringify({ type: 'connected', playerId: player.id }));

    // Heartbeat
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // Handle messages
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            _handleMessage(ws, player, msg);
        } catch (e) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        }
    });

    // Handle disconnect
    ws.on('close', () => {
        _handleDisconnect(player);
    });

    ws.on('error', () => {
        _handleDisconnect(player);
    });
}

/**
 * Route incoming messages to handlers.
 */
function _handleMessage(ws, player, msg) {
    switch (msg.type) {
        case 'join_room':
            _onJoinRoom(ws, player, msg);
            break;
        case 'leave_room':
            _onLeaveRoom(ws, player);
            break;
        case 'ready':
            _onReady(ws, player, msg);
            break;
        case 'start_game':
            _onStartGame(ws, player);
            break;
        case 'game_action':
            _onGameAction(ws, player, msg);
            break;
        case 'chat':
            _onChat(ws, player, msg);
            break;
        case 'queue_ranked':
            _onQueueRanked(ws, player, msg);
            break;
        case 'cancel_queue':
            matchmaking.dequeue(player.id);
            ws.send(JSON.stringify({ type: 'queue_cancelled' }));
            break;
        case 'friend_invite':
            _onFriendInvite(ws, player, msg);
            break;
        case 'ping':
            ws.send(JSON.stringify({ type: 'pong', serverTime: Date.now() }));
            break;
        default:
            ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
    }
}

// =========================================
// Message Handlers
// =========================================

function _onJoinRoom(ws, player, msg) {
    const result = rooms.joinRoom(msg.roomId, player);
    if (result.error) {
        ws.send(JSON.stringify({ type: 'error', message: result.error }));
        return;
    }

    rooms.setPlayerWs(msg.roomId, player.id, ws);
    ws._roomId = msg.roomId;

    // Notify the joining player
    ws.send(JSON.stringify({ type: 'room_update', room: result.room }));

    // Notify others
    rooms.broadcast(msg.roomId, {
        type: 'player_joined',
        player: { id: player.id, displayName: player.displayName, avatar: player.avatar }
    }, player.id);

    // Send updated room to all
    const updatedRoom = rooms.getRoom(msg.roomId);
    rooms.broadcastAll(msg.roomId, { type: 'room_update', room: updatedRoom });
}

function _onLeaveRoom(ws, player) {
    const roomId = ws._roomId;
    if (!roomId) return;

    const result = rooms.leaveRoom(roomId, player.id);
    ws._roomId = null;

    ws.send(JSON.stringify({ type: 'room_left' }));

    if (result && !result.closed) {
        rooms.broadcast(roomId, {
            type: 'player_left',
            playerId: player.id
        });
        rooms.broadcastAll(roomId, { type: 'room_update', room: result.room });
    }
}

function _onReady(ws, player, msg) {
    const roomId = ws._roomId;
    if (!roomId) return;

    const room = rooms.setReady(roomId, player.id, !!msg.ready);
    if (room) {
        rooms.broadcastAll(roomId, { type: 'room_update', room });
    }
}

function _onStartGame(ws, player) {
    const roomId = ws._roomId;
    if (!roomId) return;

    const result = rooms.startGame(roomId, player.id);
    if (result.error) {
        ws.send(JSON.stringify({ type: 'error', message: result.error }));
        return;
    }

    rooms.broadcastAll(roomId, {
        type: 'game_started',
        room: result.room,
        gameState: result.gameState
    });
}

function _onGameAction(ws, player, msg) {
    const roomId = ws._roomId;
    if (!roomId) return;

    const result = rooms.processAction(roomId, player.id, msg.action);
    if (!result) return;

    // Broadcast the action to all players
    rooms.broadcastAll(roomId, {
        type: 'game_action',
        playerId: player.id,
        result
    });

    // Check for game over
    if (result.type === 'game_over') {
        rooms.endGame(roomId, result.scores);
        rooms.broadcastAll(roomId, {
            type: 'game_over',
            scores: result.scores
        });
    }
}

function _onChat(ws, player, msg) {
    const roomId = ws._roomId;
    if (!roomId) return;
    if (!msg.message || msg.message.length > 500) return;

    rooms.broadcastAll(roomId, {
        type: 'chat',
        playerId: player.id,
        displayName: player.displayName,
        message: msg.message.slice(0, 500)
    });
}

// =========================================
// Ranked Matchmaking
// =========================================

function _onQueueRanked(ws, player, msg) {
    if (!msg.gameId) {
        ws.send(JSON.stringify({ type: 'error', message: 'gameId required for matchmaking' }));
        return;
    }

    const result = matchmaking.enqueue(
        {
            id: player.id,
            displayName: player.displayName,
            skillRating: msg.skillRating || 1000,
            skillDeviation: msg.skillDeviation || 350,
            region: msg.region || 'us-east',
            ws
        },
        msg.gameId,
        { mode: msg.mode || 'ranked', maxPlayers: msg.maxPlayers || 2 }
    );

    if (result.queued) {
        ws.send(JSON.stringify({
            type: 'queue_joined',
            gameId: msg.gameId,
            estimatedWait: result.estimatedWait,
            position: result.queuePosition
        }));
    } else {
        ws.send(JSON.stringify({ type: 'error', message: result.reason || 'Failed to join queue' }));
    }
}

// =========================================
// Friend Invites
// =========================================

function _onFriendInvite(ws, player, msg) {
    const targetId = msg.friendId;
    if (!targetId || !msg.roomId) return;

    const targetWs = _connections.get(targetId);
    if (targetWs && targetWs.readyState === 1) {
        targetWs.send(JSON.stringify({
            type: 'friend_invite',
            from: { id: player.id, displayName: player.displayName },
            roomId: msg.roomId,
            gameId: msg.gameId || null
        }));
        ws.send(JSON.stringify({ type: 'invite_sent', to: targetId }));
    } else {
        ws.send(JSON.stringify({ type: 'error', message: 'Player is offline' }));
    }
}

// =========================================
// Disconnect Handling
// =========================================

function _handleDisconnect(player) {
    _connections.delete(player.id);
    matchmaking.dequeue(player.id);
    antiCheat.untrackPlayer(player.id);

    const room = rooms.getPlayerRoom(player.id);
    if (room) {
        rooms.leaveRoom(room.id, player.id);
        rooms.broadcast(room.id, {
            type: 'player_left',
            playerId: player.id
        });
        const updated = rooms.getRoom(room.id);
        if (updated) {
            rooms.broadcastAll(room.id, { type: 'room_update', room: updated });
        }
    }
}

// =========================================
// Heartbeat (detect dead connections)
// =========================================

const _heartbeatInterval = setInterval(() => {
    if (!_wss) return;
    _wss.clients.forEach(ws => {
        if (!ws.isAlive) {
            ws.terminate();
            return;
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

/**
 * Graceful shutdown.
 */
function close() {
    clearInterval(_heartbeatInterval);
    matchmaking.stop();
    for (const server of _gameServers.values()) {
        server.destroy();
    }
    _gameServers.clear();
    if (_wss) {
        _wss.clients.forEach(ws => ws.close());
        _wss.close();
    }
}

module.exports = { attach, close, matchmaking };
