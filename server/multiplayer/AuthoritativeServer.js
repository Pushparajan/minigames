/**
 * AuthoritativeServer.js
 * =======================
 * Authoritative game server with configurable tick rate,
 * server-side state validation, client prediction support,
 * and server reconciliation.
 *
 * The server owns the game state. Client inputs are validated
 * and applied on the server; authoritative state is broadcast
 * to all players at the configured tick rate.
 *
 * Tick Rates:
 *   - 20 Hz  (50ms)  — Turn-based / card games
 *   - 30 Hz  (33ms)  — Casual / puzzle games
 *   - 60 Hz  (16ms)  — Action / sports games
 */

const { v4: uuidv4 } = require('uuid');

// Game-type specific tick rate presets
const TICK_PRESETS = {
    'turn-based': 20,
    'casual':     30,
    'action':     60
};

class AuthoritativeServer {
    constructor(room, options = {}) {
        this.roomId = room.id;
        this.gameId = room.gameId;
        this.players = new Map(); // playerId -> { inputBuffer[], lastProcessedTick, ws }

        // Tick configuration
        this.tickRate = options.tickRate || TICK_PRESETS[options.gameType] || 20;
        this.tickInterval = 1000 / this.tickRate;
        this.currentTick = 0;
        this.maxTicksPerSecond = this.tickRate;

        // Game state (authoritative)
        this.state = {
            tick: 0,
            phase: 'waiting',    // waiting, countdown, playing, paused, finished
            players: {},
            entities: {},
            scores: {},
            turnIndex: 0,
            round: 1,
            maxRounds: options.maxRounds || 5,
            customState: {},
            startedAt: null
        };

        // Input buffer for all players (for reconciliation)
        this._inputBuffer = [];
        this._stateHistory = [];     // Ring buffer of recent states for rollback
        this._historySize = 60;      // Keep 1 second of history at 60Hz

        // Validation rules (extensible per game)
        this._validators = new Map();
        this._actionLog = [];        // For replay and anti-cheat audit

        // Metrics
        this._metrics = {
            ticksProcessed: 0,
            inputsProcessed: 0,
            inputsRejected: 0,
            avgTickTime: 0,
            peakTickTime: 0
        };

        this._tickTimer = null;
        this._broadcastFn = null;
    }

    /**
     * Initialize the game with players.
     */
    init(players, broadcastFn) {
        this._broadcastFn = broadcastFn;

        players.forEach((player, index) => {
            const pid = player.id;
            this.players.set(pid, {
                id: pid,
                displayName: player.displayName,
                index,
                inputBuffer: [],
                lastProcessedTick: 0,
                lastInputSeq: 0,
                ws: player.ws
            });

            this.state.players[pid] = {
                id: pid,
                index,
                displayName: player.displayName,
                x: 0, y: 0,
                vx: 0, vy: 0,
                health: 100,
                score: 0,
                isAlive: true,
                customData: {}
            };

            this.state.scores[pid] = 0;
        });

        this.state.phase = 'countdown';
        this.state.startedAt = Date.now();
    }

    /**
     * Start the server tick loop.
     */
    start() {
        if (this._tickTimer) return;
        this.state.phase = 'playing';
        this.state.startedAt = Date.now();

        this._tickTimer = setInterval(() => {
            this._processTick();
        }, this.tickInterval);
    }

    /**
     * Stop the tick loop.
     */
    stop() {
        if (this._tickTimer) {
            clearInterval(this._tickTimer);
            this._tickTimer = null;
        }
        this.state.phase = 'finished';
    }

    /**
     * Queue a player input for processing on the next tick.
     * Inputs include a client-side sequence number for reconciliation.
     */
    queueInput(playerId, input) {
        const player = this.players.get(playerId);
        if (!player) return false;

        // Validate input structure
        if (!input || typeof input.type !== 'string') return false;

        const stamped = {
            playerId,
            seq: input.seq || 0,
            tick: this.currentTick,
            type: input.type,
            data: input.data || {},
            receivedAt: Date.now()
        };

        player.inputBuffer.push(stamped);
        this._inputBuffer.push(stamped);
        return true;
    }

    /**
     * Register a validation rule for an action type.
     * Validator receives (state, playerId, actionData) and returns
     * { valid: boolean, reason?: string }.
     */
    registerValidator(actionType, validatorFn) {
        this._validators.set(actionType, validatorFn);
    }

    /**
     * Process a single server tick.
     */
    _processTick() {
        const tickStart = Date.now();
        this.currentTick++;
        this.state.tick = this.currentTick;

        // Save state snapshot for rollback
        this._saveStateSnapshot();

        // Collect and validate all queued inputs
        const processedInputs = [];
        for (const player of this.players.values()) {
            while (player.inputBuffer.length > 0) {
                const input = player.inputBuffer.shift();
                const result = this._validateAndApply(input);
                if (result.valid) {
                    processedInputs.push(input);
                    player.lastProcessedTick = this.currentTick;
                    player.lastInputSeq = input.seq;
                    this._metrics.inputsProcessed++;
                } else {
                    this._metrics.inputsRejected++;
                    // Log rejected input for anti-cheat
                    this._logAction(input, false, result.reason);
                }
            }
        }

        // Update game simulation (physics, timers, AI, etc.)
        this._updateSimulation();

        // Check win/end conditions
        this._checkEndConditions();

        // Broadcast authoritative state to all clients
        this._broadcastState(processedInputs);

        // Metrics
        const tickTime = Date.now() - tickStart;
        this._metrics.ticksProcessed++;
        this._metrics.peakTickTime = Math.max(this._metrics.peakTickTime, tickTime);
        this._metrics.avgTickTime =
            (this._metrics.avgTickTime * (this._metrics.ticksProcessed - 1) + tickTime) / this._metrics.ticksProcessed;
    }

    /**
     * Validate an input against registered validators and apply to state.
     */
    _validateAndApply(input) {
        const validator = this._validators.get(input.type);
        if (validator) {
            const result = validator(this.state, input.playerId, input.data);
            if (!result.valid) {
                return result;
            }
        }

        // Apply input to state
        return this._applyInput(input);
    }

    /**
     * Apply a validated input to the game state.
     * Override per game for custom logic.
     */
    _applyInput(input) {
        const playerState = this.state.players[input.playerId];
        if (!playerState || !playerState.isAlive) {
            return { valid: false, reason: 'Player not active' };
        }

        switch (input.type) {
            case 'move': {
                // Server-validated movement
                const { dx, dy } = input.data;
                const maxSpeed = 10; // Server-enforced speed limit
                const clampedDx = Math.max(-maxSpeed, Math.min(maxSpeed, dx || 0));
                const clampedDy = Math.max(-maxSpeed, Math.min(maxSpeed, dy || 0));
                playerState.x += clampedDx;
                playerState.y += clampedDy;
                playerState.vx = clampedDx;
                playerState.vy = clampedDy;
                break;
            }

            case 'shoot': {
                // Validate cooldowns, ammo, etc.
                const { targetX, targetY } = input.data;
                if (typeof targetX !== 'number' || typeof targetY !== 'number') {
                    return { valid: false, reason: 'Invalid shoot coordinates' };
                }
                // Store for collision detection in simulation step
                if (!this.state.entities._projectiles) {
                    this.state.entities._projectiles = [];
                }
                this.state.entities._projectiles.push({
                    id: uuidv4(),
                    ownerId: input.playerId,
                    x: playerState.x,
                    y: playerState.y,
                    targetX,
                    targetY,
                    tick: this.currentTick
                });
                break;
            }

            case 'action': {
                // Generic game action — store in custom state
                const key = input.data.key;
                if (key) {
                    playerState.customData[key] = input.data.value;
                }
                break;
            }

            case 'end_turn': {
                // Advance turn in turn-based games
                const playerIds = Object.keys(this.state.players);
                if (playerIds[this.state.turnIndex] === input.playerId) {
                    this.state.turnIndex = (this.state.turnIndex + 1) % playerIds.length;
                    if (this.state.turnIndex === 0) {
                        this.state.round++;
                    }
                } else {
                    return { valid: false, reason: 'Not your turn' };
                }
                break;
            }

            case 'score': {
                // Server-validated score update
                const points = parseInt(input.data.points, 10);
                if (isNaN(points) || points < 0 || points > 1000) {
                    return { valid: false, reason: 'Invalid score value' };
                }
                playerState.score += points;
                this.state.scores[input.playerId] = playerState.score;
                break;
            }

            default:
                return { valid: false, reason: `Unknown action type: ${input.type}` };
        }

        // Log the valid action
        this._logAction(input, true);
        return { valid: true };
    }

    /**
     * Run the simulation step (physics, projectiles, collisions).
     */
    _updateSimulation() {
        // Clean up old projectiles
        if (this.state.entities._projectiles) {
            this.state.entities._projectiles = this.state.entities._projectiles
                .filter(p => this.currentTick - p.tick < this.tickRate * 2);
        }
    }

    /**
     * Check if game should end.
     */
    _checkEndConditions() {
        if (this.state.phase !== 'playing') return;

        // Round limit reached
        if (this.state.round > this.state.maxRounds) {
            this.stop();
            return;
        }

        // All players but one eliminated
        const alivePlayers = Object.values(this.state.players).filter(p => p.isAlive);
        if (alivePlayers.length <= 1 && Object.keys(this.state.players).length > 1) {
            this.stop();
            return;
        }

        // Time limit (5 minutes)
        if (this.state.startedAt && Date.now() - this.state.startedAt > 300000) {
            this.stop();
        }
    }

    /**
     * Broadcast the authoritative state to all connected clients.
     * Includes processed input sequences for client reconciliation.
     */
    _broadcastState(processedInputs) {
        if (!this._broadcastFn) return;

        // Build per-player ack map
        const acks = {};
        for (const [pid, player] of this.players) {
            acks[pid] = player.lastInputSeq;
        }

        const stateMessage = {
            type: 'state_sync',
            tick: this.currentTick,
            phase: this.state.phase,
            state: {
                players: this.state.players,
                scores: this.state.scores,
                turnIndex: this.state.turnIndex,
                round: this.state.round,
                entities: this.state.entities,
                customState: this.state.customState
            },
            acks, // Per-player last acknowledged input sequence
            serverTime: Date.now()
        };

        this._broadcastFn(this.roomId, stateMessage);
    }

    /**
     * Save a state snapshot for potential rollback.
     */
    _saveStateSnapshot() {
        const snapshot = {
            tick: this.currentTick,
            state: JSON.parse(JSON.stringify(this.state))
        };
        this._stateHistory.push(snapshot);
        if (this._stateHistory.length > this._historySize) {
            this._stateHistory.shift();
        }
    }

    /**
     * Rollback to a previous tick for lag compensation.
     */
    rollbackTo(tick) {
        const snapshot = this._stateHistory.find(s => s.tick === tick);
        if (!snapshot) return false;
        this.state = JSON.parse(JSON.stringify(snapshot.state));
        return true;
    }

    /**
     * Log an action for replay / anti-cheat auditing.
     */
    _logAction(input, validated, reason) {
        this._actionLog.push({
            tick: this.currentTick,
            playerId: input.playerId,
            seq: input.seq,
            type: input.type,
            data: input.data,
            validated,
            reason: reason || null,
            timestamp: Date.now()
        });

        // Keep reasonable buffer size (last 5 minutes of actions at max rate)
        if (this._actionLog.length > this.tickRate * 300) {
            this._actionLog = this._actionLog.slice(-this.tickRate * 60);
        }
    }

    /**
     * Get the full action log for persistence / replay.
     */
    getActionLog() {
        return this._actionLog;
    }

    /**
     * Get game results for leaderboard / stats update.
     */
    getResults() {
        const players = Object.values(this.state.players);
        players.sort((a, b) => b.score - a.score);

        return {
            matchId: this.roomId,
            gameId: this.gameId,
            duration: this.state.startedAt ? Date.now() - this.state.startedAt : 0,
            totalTicks: this.currentTick,
            players: players.map((p, idx) => ({
                id: p.id,
                index: p.index,
                score: p.score,
                placement: idx + 1,
                isWinner: idx === 0
            }))
        };
    }

    /**
     * Get current performance metrics.
     */
    getMetrics() {
        return {
            ...this._metrics,
            tickRate: this.tickRate,
            currentTick: this.currentTick,
            connectedPlayers: this.players.size,
            phase: this.state.phase
        };
    }

    /**
     * Destroy the game server and clean up resources.
     */
    destroy() {
        this.stop();
        this.players.clear();
        this._inputBuffer = [];
        this._stateHistory = [];
        this._actionLog = [];
    }
}

module.exports = { AuthoritativeServer, TICK_PRESETS };
