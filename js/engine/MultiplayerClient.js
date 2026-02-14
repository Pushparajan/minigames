/**
 * MultiplayerClient.js
 * =====================
 * Browser-side WebSocket client for real-time multiplayer.
 * Manages connection, room lifecycle, game state sync,
 * and provides an event-driven API for game scenes.
 *
 * Usage from a Phaser scene:
 *   MultiplayerClient.connect(token);
 *   MultiplayerClient.on('game_started', (data) => { ... });
 *   MultiplayerClient.sendAction({ type: 'move', data: { x, y } });
 */

const MultiplayerClient = (() => {
    'use strict';

    const API_BASE = '/api/v1/multiplayer';
    let _ws = null;
    let _token = null;
    let _playerId = null;
    let _currentRoom = null;
    let _connected = false;
    let _reconnectTimer = null;
    let _reconnectAttempts = 0;
    const MAX_RECONNECT = 5;
    const RECONNECT_BASE = 2000;

    /** Event listeners: { eventType: [callback, ...] } */
    const _listeners = {};

    // =========================================
    // Connection
    // =========================================

    /**
     * Connect to the multiplayer WebSocket server.
     * @param {string} token - JWT auth token
     */
    function connect(token) {
        if (_ws && _ws.readyState <= 1) return; // Already connected/connecting

        _token = token || localStorage.getItem('stem_auth_token');
        if (!_token) {
            _emit('error', { message: 'Not authenticated' });
            return;
        }

        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${location.host}/ws?token=${encodeURIComponent(_token)}`;

        _ws = new WebSocket(wsUrl);

        _ws.onopen = () => {
            _connected = true;
            _reconnectAttempts = 0;
            _emit('connected');
            _startPing();
        };

        _ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                _handleMessage(msg);
            } catch (e) {
                console.warn('MultiplayerClient: Invalid message', e);
            }
        };

        _ws.onclose = (event) => {
            _connected = false;
            _stopPing();
            _emit('disconnected', { code: event.code, reason: event.reason });

            // Auto-reconnect if not intentional close
            if (event.code !== 4000 && event.code !== 1000 && _reconnectAttempts < MAX_RECONNECT) {
                const delay = RECONNECT_BASE * Math.pow(2, _reconnectAttempts);
                _reconnectAttempts++;
                _reconnectTimer = setTimeout(() => connect(_token), delay);
            }
        };

        _ws.onerror = () => {
            _emit('error', { message: 'WebSocket connection error' });
        };
    }

    /**
     * Disconnect from the server.
     */
    function disconnect() {
        if (_reconnectTimer) clearTimeout(_reconnectTimer);
        _reconnectAttempts = MAX_RECONNECT; // Prevent auto-reconnect
        if (_ws) {
            _ws.close(1000, 'User disconnect');
            _ws = null;
        }
        _connected = false;
        _currentRoom = null;
    }

    function isConnected() { return _connected; }
    function getPlayerId() { return _playerId; }
    function getCurrentRoom() { return _currentRoom; }

    // =========================================
    // Room Management (REST + WS)
    // =========================================

    /**
     * Create a new room via REST API.
     */
    async function createRoom(gameId, options = {}) {
        const res = await _apiRequest('POST', '/rooms', {
            gameId,
            name: options.name,
            maxPlayers: options.maxPlayers || 2,
            isPrivate: options.isPrivate || false
        });

        if (res.room) {
            _currentRoom = res.room;
            // Join via WebSocket for real-time updates
            _send({ type: 'join_room', roomId: res.room.id });
        }
        return res;
    }

    /**
     * List available rooms.
     */
    async function listRooms(gameId) {
        return _apiRequest('GET', '/rooms' + (gameId ? `?gameId=${gameId}` : ''));
    }

    /**
     * Join a room (via WS for real-time).
     */
    function joinRoom(roomId) {
        _send({ type: 'join_room', roomId });
    }

    /**
     * Leave the current room.
     */
    function leaveRoom() {
        _send({ type: 'leave_room' });
        _currentRoom = null;
    }

    /**
     * Toggle ready state.
     */
    function setReady(ready) {
        _send({ type: 'ready', ready });
    }

    /**
     * Start the game (host only).
     */
    function startGame() {
        _send({ type: 'start_game' });
    }

    /**
     * Quick matchmaking: find or create a room.
     */
    async function quickMatch(gameId) {
        const res = await _apiRequest('POST', '/matchmake', { gameId });
        if (res.room) {
            _currentRoom = res.room;
            _send({ type: 'join_room', roomId: res.room.id });
        }
        return res;
    }

    // =========================================
    // Game Actions
    // =========================================

    /**
     * Send a game action to the server.
     * @param {Object} action - { type: 'move'|'shoot'|'action'|..., data: {...} }
     */
    function sendAction(action) {
        _send({ type: 'game_action', action });
    }

    /**
     * Send a chat message.
     */
    function sendChat(message) {
        _send({ type: 'chat', message });
    }

    // =========================================
    // Event System
    // =========================================

    /**
     * Subscribe to an event.
     * Events: connected, disconnected, error, room_update,
     *         player_joined, player_left, game_started,
     *         game_action, game_over, chat
     */
    function on(event, callback) {
        if (!_listeners[event]) _listeners[event] = [];
        _listeners[event].push(callback);
    }

    /**
     * Unsubscribe from an event.
     */
    function off(event, callback) {
        if (!_listeners[event]) return;
        _listeners[event] = _listeners[event].filter(cb => cb !== callback);
    }

    function _emit(event, data) {
        if (_listeners[event]) {
            _listeners[event].forEach(cb => {
                try { cb(data); } catch (e) { console.error('MultiplayerClient event error:', e); }
            });
        }
    }

    // =========================================
    // Message Handling
    // =========================================

    function _handleMessage(msg) {
        switch (msg.type) {
            case 'connected':
                _playerId = msg.playerId;
                break;

            case 'room_update':
                _currentRoom = msg.room;
                _emit('room_update', msg.room);
                break;

            case 'player_joined':
                _emit('player_joined', msg.player);
                break;

            case 'player_left':
                _emit('player_left', { playerId: msg.playerId });
                break;

            case 'room_left':
                _currentRoom = null;
                _emit('room_left');
                break;

            case 'game_started':
                _currentRoom = msg.room;
                _emit('game_started', { room: msg.room, gameState: msg.gameState });
                break;

            case 'game_action':
                _emit('game_action', { playerId: msg.playerId, result: msg.result });
                break;

            case 'game_over':
                _emit('game_over', { scores: msg.scores });
                break;

            case 'chat':
                _emit('chat', {
                    playerId: msg.playerId,
                    displayName: msg.displayName,
                    message: msg.message
                });
                break;

            case 'error':
                _emit('error', { message: msg.message });
                break;

            case 'pong':
                // Heartbeat response — do nothing
                break;
        }
    }

    // =========================================
    // Internal Helpers
    // =========================================

    function _send(data) {
        if (_ws && _ws.readyState === WebSocket.OPEN) {
            _ws.send(JSON.stringify(data));
        }
    }

    let _pingInterval = null;
    function _startPing() {
        _stopPing();
        _pingInterval = setInterval(() => {
            _send({ type: 'ping' });
        }, 25000);
    }
    function _stopPing() {
        if (_pingInterval) {
            clearInterval(_pingInterval);
            _pingInterval = null;
        }
    }

    async function _apiRequest(method, path, body) {
        const headers = { 'Content-Type': 'application/json' };
        const token = _token || localStorage.getItem('stem_auth_token');
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const opts = { method, headers };
        if (body && method !== 'GET') opts.body = JSON.stringify(body);

        const res = await fetch(API_BASE + path, opts);
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Request failed');
        }
        return res.json();
    }

    return {
        connect,
        disconnect,
        isConnected,
        getPlayerId,
        getCurrentRoom,
        // Rooms
        createRoom,
        listRooms,
        joinRoom,
        leaveRoom,
        setReady,
        startGame,
        quickMatch,
        // Game
        sendAction,
        sendChat,
        // Events
        on,
        off
    };
})();
