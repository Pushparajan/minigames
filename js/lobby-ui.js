/**
 * LobbyUI.js
 * ============
 * Multiplayer lobby interface. Handles room browsing, creation,
 * waiting room, chat, and game start. Integrates with
 * MultiplayerClient for WebSocket communication.
 */

const LobbyUI = (() => {
    'use strict';

    let _isReady = false;
    let _isHost = false;

    // =========================================
    // Show / Hide
    // =========================================

    function show() {
        if (!localStorage.getItem('stem_auth_token')) {
            SiteUI.showLogin();
            return;
        }

        // Connect to WS if not already
        if (!MultiplayerClient.isConnected()) {
            MultiplayerClient.connect();
        }

        _populateGameFilters();
        _setupEventListeners();
        showList();
        refresh();

        // Show via SiteUI modal system
        const overlay = document.getElementById('modal-overlay');
        overlay.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
        overlay.style.display = 'flex';
        document.getElementById('modal-lobby').style.display = 'block';
    }

    function _populateGameFilters() {
        const filterSelect = document.getElementById('lobby-game-filter');
        const createSelect = document.getElementById('create-game');

        // Only populate once
        if (filterSelect.options.length > 1) return;

        const games = GameRegistry.getAll();
        games.forEach(g => {
            filterSelect.add(new Option(g.title, g.id));
            createSelect.add(new Option(g.title, g.id));
        });
    }

    let _listenersAttached = false;
    function _setupEventListeners() {
        if (_listenersAttached) return;
        _listenersAttached = true;

        MultiplayerClient.on('room_update', _onRoomUpdate);
        MultiplayerClient.on('player_joined', _onPlayerJoined);
        MultiplayerClient.on('player_left', _onPlayerLeft);
        MultiplayerClient.on('game_started', _onGameStarted);
        MultiplayerClient.on('game_over', _onGameOver);
        MultiplayerClient.on('chat', _onChat);
        MultiplayerClient.on('error', _onError);
        MultiplayerClient.on('room_left', () => showList());
    }

    // =========================================
    // Views
    // =========================================

    function showList() {
        document.getElementById('lobby-list').style.display = 'block';
        document.getElementById('lobby-create').style.display = 'none';
        document.getElementById('lobby-room').style.display = 'none';
        refresh();
    }

    function showCreate() {
        document.getElementById('lobby-list').style.display = 'none';
        document.getElementById('lobby-create').style.display = 'block';
        document.getElementById('lobby-room').style.display = 'none';
    }

    function _showRoom(room) {
        document.getElementById('lobby-list').style.display = 'none';
        document.getElementById('lobby-create').style.display = 'none';
        document.getElementById('lobby-room').style.display = 'block';
        _renderRoom(room);
    }

    // =========================================
    // Room List
    // =========================================

    async function refresh() {
        const gameId = document.getElementById('lobby-game-filter').value || undefined;
        try {
            const data = await MultiplayerClient.listRooms(gameId);
            _renderRoomList(data.rooms || []);
        } catch (e) {
            console.warn('LobbyUI: Failed to fetch rooms', e);
        }
    }

    function _renderRoomList(rooms) {
        const container = document.getElementById('lobby-rooms');

        if (rooms.length === 0) {
            container.innerHTML = '<p class="lobby-empty">No rooms available. Create one or use Quick Match!</p>';
            return;
        }

        container.innerHTML = rooms.map(room => {
            const game = GameRegistry.getById(room.gameId);
            const gameName = game ? game.title : room.gameId;
            return `
                <div class="lobby-room-card" onclick="LobbyUI.joinRoom('${room.id}')">
                    <div class="lobby-room-info">
                        <strong>${_escapeHtml(room.name)}</strong>
                        <span class="lobby-room-game">${_escapeHtml(gameName)}</span>
                    </div>
                    <div class="lobby-room-meta">
                        <span class="lobby-room-players">${room.playerCount}/${room.maxPlayers}</span>
                        <span class="lobby-room-state">${room.state}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    // =========================================
    // Create Room
    // =========================================

    async function handleCreate(event) {
        event.preventDefault();

        const gameId = document.getElementById('create-game').value;
        const name = document.getElementById('create-name').value.trim();
        const maxPlayers = parseInt(document.getElementById('create-max').value, 10);
        const isPrivate = document.getElementById('create-private').checked;

        try {
            const res = await MultiplayerClient.createRoom(gameId, { name, maxPlayers, isPrivate });
            if (res.room) _showRoom(res.room);
        } catch (e) {
            alert(e.message || 'Failed to create room');
        }
    }

    // =========================================
    // Join Room
    // =========================================

    function joinRoom(roomId) {
        MultiplayerClient.joinRoom(roomId);
        // Room view will be shown when room_update event arrives
    }

    // =========================================
    // Quick Match
    // =========================================

    async function quickMatch(gameId) {
        if (!localStorage.getItem('stem_auth_token')) {
            SiteUI.showLogin();
            return;
        }

        if (!MultiplayerClient.isConnected()) {
            MultiplayerClient.connect();
            // Wait for connection
            await new Promise(resolve => {
                MultiplayerClient.on('connected', resolve);
                setTimeout(resolve, 3000);
            });
        }

        try {
            const res = await MultiplayerClient.quickMatch(gameId);
            show();
            if (res.room) _showRoom(res.room);
        } catch (e) {
            alert(e.message || 'Matchmaking failed');
        }
    }

    // =========================================
    // Room View
    // =========================================

    function _renderRoom(room) {
        const myId = MultiplayerClient.getPlayerId();
        _isHost = room.hostId === myId;

        document.getElementById('room-name').textContent = room.name;
        const game = GameRegistry.getById(room.gameId);
        document.getElementById('room-game').textContent = game ? game.title : room.gameId;

        // Players
        const playersEl = document.getElementById('room-players');
        playersEl.innerHTML = room.players.map(p => {
            const isMe = p.id === myId;
            return `
                <div class="room-player ${isMe ? 'room-player-me' : ''} ${p.isReady ? 'room-player-ready' : ''}">
                    <span class="room-player-name">${_escapeHtml(p.displayName)}${p.isHost ? ' (Host)' : ''}</span>
                    <span class="room-player-status">${p.isReady ? 'Ready' : 'Not Ready'}</span>
                </div>
            `;
        }).join('');

        // Show start button for host, ready button for others
        const startBtn = document.getElementById('room-start-btn');
        const readyBtn = document.getElementById('room-ready-btn');

        if (_isHost) {
            startBtn.style.display = 'inline-block';
            readyBtn.style.display = 'none';
        } else {
            startBtn.style.display = 'none';
            readyBtn.style.display = 'inline-block';
            readyBtn.textContent = _isReady ? 'Not Ready' : 'Ready';
        }
    }

    function toggleReady() {
        _isReady = !_isReady;
        MultiplayerClient.setReady(_isReady);
    }

    function startGame() {
        MultiplayerClient.startGame();
    }

    function leave() {
        _isReady = false;
        MultiplayerClient.leaveRoom();
        showList();
    }

    // =========================================
    // Chat
    // =========================================

    function sendChat() {
        const input = document.getElementById('room-chat-text');
        const msg = input.value.trim();
        if (!msg) return;
        MultiplayerClient.sendChat(msg);
        input.value = '';
    }

    function _appendChat(name, message) {
        const container = document.getElementById('room-chat-messages');
        const div = document.createElement('div');
        div.className = 'chat-msg';
        div.innerHTML = `<strong>${_escapeHtml(name)}</strong>: ${_escapeHtml(message)}`;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    // =========================================
    // Event Handlers
    // =========================================

    function _onRoomUpdate(room) {
        _showRoom(room);
    }

    function _onPlayerJoined(player) {
        _appendChat('System', `${player.displayName} joined the room`);
    }

    function _onPlayerLeft(data) {
        _appendChat('System', 'A player left the room');
    }

    function _onGameStarted(data) {
        // Close the lobby modal and launch the game
        SiteUI.closeModal();
        const room = data.room;
        const game = GameRegistry.getById(room.gameId);
        if (game) {
            // Launch the Phaser game — the game scene can access MultiplayerClient
            document.getElementById('launcher').style.display = 'none';
            document.getElementById('game-container').style.display = 'block';
            document.getElementById('hud-title').textContent = game.title + ' (Multiplayer)';
            document.getElementById('hud-score').textContent = 'Score: 0';

            // Store multiplayer state for game scenes to access
            window._multiplayerState = {
                room: data.room,
                gameState: data.gameState,
                playerId: MultiplayerClient.getPlayerId(),
                playerIndex: room.players.findIndex(p => p.id === MultiplayerClient.getPlayerId())
            };
        }
    }

    function _onGameOver(data) {
        const myIndex = window._multiplayerState?.playerIndex ?? 0;
        const myScore = data.scores[myIndex] || 0;
        const maxScore = Math.max(...data.scores);
        const won = myScore === maxScore;

        alert(won ? 'You won! Score: ' + myScore : 'Game over! Score: ' + myScore);
    }

    function _onChat(data) {
        _appendChat(data.displayName, data.message);
    }

    function _onError(data) {
        console.warn('LobbyUI error:', data.message);
    }

    // =========================================
    // Helpers
    // =========================================

    function _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return {
        show,
        showList,
        showCreate,
        refresh,
        handleCreate,
        joinRoom,
        quickMatch,
        toggleReady,
        startGame,
        leave,
        sendChat
    };
})();
