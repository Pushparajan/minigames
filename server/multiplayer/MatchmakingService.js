/**
 * MatchmakingService.js
 * ======================
 * Skill-Based (SBMM) and Latency-Based (Region) matchmaking.
 *
 * Features:
 *   - Glicko-2 inspired skill rating with rating deviation
 *   - Region-aware grouping with fallback to global
 *   - Progressive skill range expansion over wait time
 *   - Queue management with timeout and cancellation
 *   - Support for ranked and casual modes
 */

const { v4: uuidv4 } = require('uuid');

// Matchmaking configuration
const CONFIG = {
    INITIAL_SKILL: 1000,
    INITIAL_DEVIATION: 350,
    SKILL_RANGE_BASE: 100,        // Base skill range window
    SKILL_RANGE_EXPANSION: 50,    // Expand range every expansion interval
    EXPANSION_INTERVAL: 5000,     // 5 seconds between expansions
    MAX_SKILL_RANGE: 500,         // Maximum skill range before accepting anyone
    MAX_WAIT_TIME: 30000,         // 30 second queue timeout
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 4,
    REGION_PRIORITY: true,        // Prefer same-region matches
    CROSS_REGION_DELAY: 10000,    // Allow cross-region after 10s
    K_FACTOR: 32,                 // Elo K-factor for rating changes
    PLACEMENT_MATCHES: 10         // Matches before rating stabilizes
};

// Region latency estimates (ms) for cross-region matching
const REGION_LATENCY = {
    'us-east':   { 'us-west': 60, 'eu-west': 80, 'eu-central': 90, 'asia-east': 150, 'asia-south': 170, 'oceania': 180, 'sa-east': 100 },
    'us-west':   { 'us-east': 60, 'eu-west': 120, 'eu-central': 130, 'asia-east': 100, 'asia-south': 140, 'oceania': 120, 'sa-east': 130 },
    'eu-west':   { 'us-east': 80, 'us-west': 120, 'eu-central': 20, 'asia-east': 160, 'asia-south': 120, 'oceania': 200, 'sa-east': 140 },
    'eu-central': { 'us-east': 90, 'us-west': 130, 'eu-west': 20, 'asia-east': 140, 'asia-south': 100, 'oceania': 190, 'sa-east': 150 },
    'asia-east': { 'us-east': 150, 'us-west': 100, 'eu-west': 160, 'eu-central': 140, 'asia-south': 60, 'oceania': 80, 'sa-east': 200 },
    'asia-south': { 'us-east': 170, 'us-west': 140, 'eu-west': 120, 'eu-central': 100, 'asia-east': 60, 'oceania': 120, 'sa-east': 220 },
    'oceania':   { 'us-east': 180, 'us-west': 120, 'eu-west': 200, 'eu-central': 190, 'asia-east': 80, 'asia-south': 120, 'sa-east': 220 },
    'sa-east':   { 'us-east': 100, 'us-west': 130, 'eu-west': 140, 'eu-central': 150, 'asia-east': 200, 'asia-south': 220, 'oceania': 220 }
};

class MatchmakingService {
    constructor() {
        // Queues per game: gameId -> Map(region -> QueueEntry[])
        this._queues = new Map();
        // Player lookup: playerId -> { gameId, region, queuedAt }
        this._playerQueue = new Map();
        // Match results callback
        this._onMatchFound = null;
        // Processing interval
        this._processTimer = null;
    }

    /**
     * Start the matchmaking processing loop.
     * @param {Function} onMatchFound - Called with (matchData) when a match is found
     */
    start(onMatchFound) {
        this._onMatchFound = onMatchFound;
        this._processTimer = setInterval(() => this._processQueues(), 1000);
    }

    /**
     * Stop the matchmaking service.
     */
    stop() {
        if (this._processTimer) {
            clearInterval(this._processTimer);
            this._processTimer = null;
        }
    }

    /**
     * Add a player to the matchmaking queue.
     * @param {Object} player - { id, displayName, skillRating, skillDeviation, region }
     * @param {string} gameId - Game to queue for
     * @param {Object} options - { mode: 'ranked'|'casual', maxPlayers }
     * @returns {{ queued: boolean, estimatedWait?: number }}
     */
    enqueue(player, gameId, options = {}) {
        // Don't allow double-queue
        if (this._playerQueue.has(player.id)) {
            return { queued: false, reason: 'Already in queue' };
        }

        const region = player.region || 'us-east';
        const entry = {
            id: uuidv4(),
            playerId: player.id,
            displayName: player.displayName,
            skillRating: player.skillRating || CONFIG.INITIAL_SKILL,
            skillDeviation: player.skillDeviation || CONFIG.INITIAL_DEVIATION,
            region,
            mode: options.mode || 'casual',
            maxPlayers: options.maxPlayers || CONFIG.MIN_PLAYERS,
            queuedAt: Date.now(),
            ws: player.ws || null
        };

        // Get or create game queue
        if (!this._queues.has(gameId)) {
            this._queues.set(gameId, new Map());
        }
        const gameQueue = this._queues.get(gameId);
        if (!gameQueue.has(region)) {
            gameQueue.set(region, []);
        }
        gameQueue.get(region).push(entry);

        this._playerQueue.set(player.id, { gameId, region, queuedAt: entry.queuedAt });

        // Estimate wait time based on queue depth
        const queueSize = gameQueue.get(region).length;
        const estimatedWait = Math.max(2, Math.ceil(entry.maxPlayers / Math.max(1, queueSize)) * 5);

        return { queued: true, estimatedWait, queuePosition: queueSize };
    }

    /**
     * Remove a player from the matchmaking queue.
     */
    dequeue(playerId) {
        const info = this._playerQueue.get(playerId);
        if (!info) return false;

        const gameQueue = this._queues.get(info.gameId);
        if (gameQueue) {
            const regionQueue = gameQueue.get(info.region);
            if (regionQueue) {
                const idx = regionQueue.findIndex(e => e.playerId === playerId);
                if (idx !== -1) regionQueue.splice(idx, 1);
            }
        }

        this._playerQueue.delete(playerId);
        return true;
    }

    /**
     * Get queue status for a player.
     */
    getQueueStatus(playerId) {
        const info = this._playerQueue.get(playerId);
        if (!info) return null;
        return {
            gameId: info.gameId,
            region: info.region,
            waitTime: Date.now() - info.queuedAt,
            queuedAt: info.queuedAt
        };
    }

    /**
     * Get overall queue statistics.
     */
    getStats() {
        const stats = { totalQueued: this._playerQueue.size, games: {} };
        for (const [gameId, regionMap] of this._queues) {
            stats.games[gameId] = {};
            for (const [region, queue] of regionMap) {
                stats.games[gameId][region] = queue.length;
            }
        }
        return stats;
    }

    /**
     * Process all queues and form matches.
     */
    _processQueues() {
        const now = Date.now();

        for (const [gameId, regionMap] of this._queues) {
            // First pass: match within same region
            for (const [region, queue] of regionMap) {
                this._matchWithinRegion(gameId, region, queue, now);
            }

            // Second pass: cross-region for players waiting too long
            if (CONFIG.REGION_PRIORITY) {
                this._matchCrossRegion(gameId, regionMap, now);
            }

            // Clean up timed-out players
            for (const [region, queue] of regionMap) {
                this._cleanupTimeouts(queue, now);
            }
        }
    }

    /**
     * Try to form matches within a single region.
     */
    _matchWithinRegion(gameId, region, queue, now) {
        if (queue.length < CONFIG.MIN_PLAYERS) return;

        // Sort by skill rating
        queue.sort((a, b) => a.skillRating - b.skillRating);

        let i = 0;
        while (i < queue.length) {
            const anchor = queue[i];
            const waitTime = now - anchor.queuedAt;
            const skillRange = this._getSkillRange(waitTime);

            // Find compatible players within skill range
            const candidates = [anchor];
            for (let j = i + 1; j < queue.length && candidates.length < anchor.maxPlayers; j++) {
                const diff = Math.abs(queue[j].skillRating - anchor.skillRating);
                if (diff <= skillRange && queue[j].mode === anchor.mode) {
                    candidates.push(queue[j]);
                }
            }

            if (candidates.length >= CONFIG.MIN_PLAYERS) {
                // Match found
                const matchPlayers = candidates.slice(0, anchor.maxPlayers);
                this._formMatch(gameId, region, matchPlayers);

                // Remove matched players from queue
                const matchedIds = new Set(matchPlayers.map(p => p.playerId));
                const remaining = queue.filter(e => !matchedIds.has(e.playerId));
                queue.length = 0;
                queue.push(...remaining);

                // Clean up player queue map
                matchedIds.forEach(pid => this._playerQueue.delete(pid));
            } else {
                i++;
            }
        }
    }

    /**
     * Try cross-region matching for players waiting beyond the threshold.
     */
    _matchCrossRegion(gameId, regionMap, now) {
        // Collect all players waiting beyond cross-region delay
        const longWaiters = [];
        for (const [region, queue] of regionMap) {
            for (const entry of queue) {
                if (now - entry.queuedAt >= CONFIG.CROSS_REGION_DELAY) {
                    longWaiters.push(entry);
                }
            }
        }

        if (longWaiters.length < CONFIG.MIN_PLAYERS) return;

        // Sort by skill and try to form matches
        longWaiters.sort((a, b) => a.skillRating - b.skillRating);

        let i = 0;
        while (i < longWaiters.length - 1) {
            const anchor = longWaiters[i];
            const waitTime = now - anchor.queuedAt;
            const skillRange = this._getSkillRange(waitTime);
            const candidates = [anchor];

            for (let j = i + 1; j < longWaiters.length && candidates.length < anchor.maxPlayers; j++) {
                const other = longWaiters[j];
                const skillDiff = Math.abs(other.skillRating - anchor.skillRating);
                const latency = this._estimateLatency(anchor.region, other.region);

                // Accept if within skill range and latency is acceptable (<150ms)
                if (skillDiff <= skillRange && latency < 150 && other.mode === anchor.mode) {
                    candidates.push(other);
                }
            }

            if (candidates.length >= CONFIG.MIN_PLAYERS) {
                // Pick the best region (lowest average latency)
                const bestRegion = this._pickBestRegion(candidates);
                const matchPlayers = candidates.slice(0, anchor.maxPlayers);
                this._formMatch(gameId, bestRegion, matchPlayers);

                // Remove from all region queues
                const matchedIds = new Set(matchPlayers.map(p => p.playerId));
                for (const [region, queue] of regionMap) {
                    const remaining = queue.filter(e => !matchedIds.has(e.playerId));
                    queue.length = 0;
                    queue.push(...remaining);
                }
                matchedIds.forEach(pid => this._playerQueue.delete(pid));

                // Remove from longWaiters
                const remaining = longWaiters.filter(e => !matchedIds.has(e.playerId));
                longWaiters.length = 0;
                longWaiters.push(...remaining);
            } else {
                i++;
            }
        }
    }

    /**
     * Calculate dynamic skill range based on wait time.
     */
    _getSkillRange(waitTime) {
        const expansions = Math.floor(waitTime / CONFIG.EXPANSION_INTERVAL);
        return Math.min(
            CONFIG.SKILL_RANGE_BASE + expansions * CONFIG.SKILL_RANGE_EXPANSION,
            CONFIG.MAX_SKILL_RANGE
        );
    }

    /**
     * Estimate latency between two regions.
     */
    _estimateLatency(regionA, regionB) {
        if (regionA === regionB) return 10;
        return REGION_LATENCY[regionA]?.[regionB] || 200;
    }

    /**
     * Pick the region with lowest average latency among candidates.
     */
    _pickBestRegion(candidates) {
        const regions = [...new Set(candidates.map(c => c.region))];
        let bestRegion = candidates[0].region;
        let bestAvg = Infinity;

        for (const region of regions) {
            const totalLatency = candidates.reduce((sum, c) => {
                return sum + this._estimateLatency(region, c.region);
            }, 0);
            const avg = totalLatency / candidates.length;
            if (avg < bestAvg) {
                bestAvg = avg;
                bestRegion = region;
            }
        }

        return bestRegion;
    }

    /**
     * Form a match and notify via callback.
     */
    _formMatch(gameId, region, players) {
        const matchData = {
            matchId: uuidv4(),
            gameId,
            region,
            mode: players[0].mode,
            players: players.map(p => ({
                id: p.playerId,
                displayName: p.displayName,
                skillRating: p.skillRating,
                region: p.region,
                ws: p.ws
            })),
            createdAt: Date.now()
        };

        if (this._onMatchFound) {
            this._onMatchFound(matchData);
        }
    }

    /**
     * Remove timed-out entries.
     */
    _cleanupTimeouts(queue, now) {
        const timedOut = [];
        for (let i = queue.length - 1; i >= 0; i--) {
            if (now - queue[i].queuedAt > CONFIG.MAX_WAIT_TIME) {
                timedOut.push(queue[i]);
                queue.splice(i, 1);
            }
        }

        for (const entry of timedOut) {
            this._playerQueue.delete(entry.playerId);
            // Notify player of timeout
            if (entry.ws && entry.ws.readyState === 1) {
                entry.ws.send(JSON.stringify({
                    type: 'matchmaking_timeout',
                    gameId: entry.playerId
                }));
            }
        }
    }

    /**
     * Calculate new skill ratings after a match using Elo-based system.
     * @param {Array} results - [{ id, score, placement }] sorted by placement
     * @returns {Object} { playerId: { newRating, ratingChange } }
     */
    static calculateRatingChanges(results, playerRatings) {
        const changes = {};

        for (let i = 0; i < results.length; i++) {
            const player = results[i];
            const currentRating = playerRatings[player.id] || CONFIG.INITIAL_SKILL;
            let totalChange = 0;

            for (let j = 0; j < results.length; j++) {
                if (i === j) continue;
                const opponent = results[j];
                const opponentRating = playerRatings[opponent.id] || CONFIG.INITIAL_SKILL;

                // Expected score (Elo formula)
                const expected = 1 / (1 + Math.pow(10, (opponentRating - currentRating) / 400));
                // Actual score: 1 for win, 0.5 for draw, 0 for loss
                const actual = player.placement < opponent.placement ? 1
                    : player.placement === opponent.placement ? 0.5
                    : 0;

                totalChange += CONFIG.K_FACTOR * (actual - expected);
            }

            // Average the change across opponents
            const avgChange = Math.round(totalChange / (results.length - 1));
            const newRating = Math.max(100, currentRating + avgChange);

            changes[player.id] = {
                previousRating: currentRating,
                newRating,
                ratingChange: avgChange
            };
        }

        return changes;
    }
}

module.exports = { MatchmakingService, CONFIG as MATCHMAKING_CONFIG };
