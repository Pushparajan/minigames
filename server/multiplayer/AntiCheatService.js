/**
 * AntiCheatService.js
 * ====================
 * Server-side anti-cheat detection system.
 *
 * Features:
 *   - Input rate limiting (prevent action spam)
 *   - Movement speed validation
 *   - Score anomaly detection
 *   - Win rate statistical analysis
 *   - Impossible stats flagging (e.g. 100 wins in 1 minute)
 *   - Action frequency analysis
 *   - Automatic flagging with configurable severity thresholds
 *   - Integration with ban system
 */

const db = require('../models/db');

// Detection thresholds
const THRESHOLDS = {
    // Input rate: max actions per second
    MAX_INPUTS_PER_SECOND: 30,
    // Movement: max distance per tick
    MAX_DISTANCE_PER_TICK: 15,
    // Score: max points gained per action
    MAX_SCORE_PER_ACTION: 1000,
    // Win rate: flag if win rate > this with enough matches
    WIN_RATE_FLAG_THRESHOLD: 0.85,
    WIN_RATE_MIN_MATCHES: 20,
    // Impossible stats: wins per time window
    MAX_WINS_PER_HOUR: 30,
    MAX_WINS_PER_MINUTE: 5,
    // Session: max game duration violation
    MIN_GAME_DURATION_MS: 5000,
    // Auto-ban: critical flags before auto-ban
    AUTO_BAN_CRITICAL_FLAGS: 3,
    AUTO_BAN_WINDOW_HOURS: 24
};

class AntiCheatService {
    constructor() {
        // Per-player tracking (in memory for fast access)
        this._playerTracking = new Map(); // playerId -> tracking data
    }

    /**
     * Initialize tracking for a player when they join a game.
     */
    trackPlayer(playerId) {
        this._playerTracking.set(playerId, {
            inputTimestamps: [],
            lastPosition: null,
            totalScore: 0,
            actionCounts: {},
            gameStartedAt: Date.now(),
            flagCount: 0
        });
    }

    /**
     * Stop tracking a player.
     */
    untrackPlayer(playerId) {
        this._playerTracking.delete(playerId);
    }

    /**
     * Validate a player input and check for cheating indicators.
     * Returns { valid, flags[] }
     */
    validateInput(playerId, input, gameState) {
        const tracking = this._playerTracking.get(playerId);
        if (!tracking) return { valid: true, flags: [] };

        const flags = [];
        const now = Date.now();

        // 1. Input rate check
        tracking.inputTimestamps.push(now);
        // Keep only last second of timestamps
        tracking.inputTimestamps = tracking.inputTimestamps.filter(t => now - t < 1000);
        if (tracking.inputTimestamps.length > THRESHOLDS.MAX_INPUTS_PER_SECOND) {
            flags.push({
                type: 'input_spam',
                severity: 'warning',
                details: {
                    inputsPerSecond: tracking.inputTimestamps.length,
                    threshold: THRESHOLDS.MAX_INPUTS_PER_SECOND
                }
            });
        }

        // 2. Movement speed check
        if (input.type === 'move' && input.data) {
            const dx = Math.abs(input.data.dx || 0);
            const dy = Math.abs(input.data.dy || 0);
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > THRESHOLDS.MAX_DISTANCE_PER_TICK) {
                flags.push({
                    type: 'speed_hack',
                    severity: 'critical',
                    details: {
                        distance,
                        maxAllowed: THRESHOLDS.MAX_DISTANCE_PER_TICK,
                        dx: input.data.dx,
                        dy: input.data.dy
                    }
                });
                return { valid: false, flags }; // Reject input
            }

            // Teleportation check
            if (tracking.lastPosition) {
                const teleportDist = Math.sqrt(
                    Math.pow((input.data.dx || 0), 2) +
                    Math.pow((input.data.dy || 0), 2)
                );
                if (teleportDist > THRESHOLDS.MAX_DISTANCE_PER_TICK * 3) {
                    flags.push({
                        type: 'teleport_hack',
                        severity: 'critical',
                        details: {
                            distance: teleportDist,
                            from: tracking.lastPosition
                        }
                    });
                    return { valid: false, flags };
                }
            }

            tracking.lastPosition = {
                x: (tracking.lastPosition?.x || 0) + (input.data.dx || 0),
                y: (tracking.lastPosition?.y || 0) + (input.data.dy || 0)
            };
        }

        // 3. Score anomaly check
        if (input.type === 'score' && input.data) {
            const points = parseInt(input.data.points, 10) || 0;
            if (points > THRESHOLDS.MAX_SCORE_PER_ACTION) {
                flags.push({
                    type: 'score_anomaly',
                    severity: 'critical',
                    details: {
                        points,
                        maxAllowed: THRESHOLDS.MAX_SCORE_PER_ACTION
                    }
                });
                return { valid: false, flags };
            }
            tracking.totalScore += points;
        }

        // 4. Action frequency tracking
        const actionKey = input.type;
        tracking.actionCounts[actionKey] = (tracking.actionCounts[actionKey] || 0) + 1;

        // Persist flags if any
        if (flags.length > 0) {
            tracking.flagCount += flags.length;
            this._persistFlags(playerId, flags).catch(err => {
                console.error('AntiCheat: Failed to persist flags:', err);
            });
        }

        return { valid: true, flags };
    }

    /**
     * Analyze post-match statistics for anomalies.
     */
    async analyzeMatchResults(matchId, results, tenantId) {
        const flags = [];

        for (const player of results) {
            // Check game duration
            if (player.duration && player.duration < THRESHOLDS.MIN_GAME_DURATION_MS) {
                flags.push({
                    playerId: player.id,
                    type: 'suspicious_duration',
                    severity: 'warning',
                    details: {
                        duration: player.duration,
                        minExpected: THRESHOLDS.MIN_GAME_DURATION_MS
                    }
                });
            }

            // Check recent win rate (if winner)
            if (player.isWinner) {
                await this._checkWinRate(player.id, tenantId, flags);
                await this._checkWinFrequency(player.id, tenantId, flags);
            }
        }

        // Persist all flags
        for (const flag of flags) {
            await this._persistFlag(flag.playerId, tenantId, flag, matchId);
        }

        // Check for auto-ban thresholds
        for (const player of results) {
            await this._checkAutoBan(player.id, tenantId);
        }

        return flags;
    }

    /**
     * Check if a player's win rate is statistically improbable.
     */
    async _checkWinRate(playerId, tenantId, flags) {
        try {
            const result = await db.query(`
                SELECT mp_wins, mp_losses, mp_draws, mp_matches
                FROM players WHERE id = $1 AND tenant_id = $2
            `, [playerId, tenantId]);

            if (result.rows.length === 0) return;

            const { mp_wins, mp_matches } = result.rows[0];
            if (mp_matches >= THRESHOLDS.WIN_RATE_MIN_MATCHES) {
                const winRate = mp_wins / mp_matches;
                if (winRate > THRESHOLDS.WIN_RATE_FLAG_THRESHOLD) {
                    flags.push({
                        playerId,
                        type: 'win_rate_anomaly',
                        severity: 'warning',
                        details: {
                            winRate: Math.round(winRate * 100) / 100,
                            wins: mp_wins,
                            totalMatches: mp_matches,
                            threshold: THRESHOLDS.WIN_RATE_FLAG_THRESHOLD
                        }
                    });
                }
            }
        } catch (err) {
            console.error('AntiCheat: Win rate check failed:', err);
        }
    }

    /**
     * Check if a player is winning too frequently (impossible stats).
     * e.g., winning 100 games in 1 minute
     */
    async _checkWinFrequency(playerId, tenantId, flags) {
        try {
            // Check wins in last hour
            const hourResult = await db.query(`
                SELECT COUNT(*) as wins FROM multiplayer_match_players
                WHERE player_id = $1 AND tenant_id = $2
                    AND is_winner = TRUE
                    AND created_at > NOW() - INTERVAL '1 hour'
            `, [playerId, tenantId]);

            const hourWins = parseInt(hourResult.rows[0].wins, 10);
            if (hourWins > THRESHOLDS.MAX_WINS_PER_HOUR) {
                flags.push({
                    playerId,
                    type: 'impossible_stats',
                    severity: 'critical',
                    details: {
                        winsInHour: hourWins,
                        maxAllowed: THRESHOLDS.MAX_WINS_PER_HOUR
                    }
                });
            }

            // Check wins in last minute
            const minuteResult = await db.query(`
                SELECT COUNT(*) as wins FROM multiplayer_match_players
                WHERE player_id = $1 AND tenant_id = $2
                    AND is_winner = TRUE
                    AND created_at > NOW() - INTERVAL '1 minute'
            `, [playerId, tenantId]);

            const minuteWins = parseInt(minuteResult.rows[0].wins, 10);
            if (minuteWins > THRESHOLDS.MAX_WINS_PER_MINUTE) {
                flags.push({
                    playerId,
                    type: 'impossible_stats',
                    severity: 'critical',
                    details: {
                        winsInMinute: minuteWins,
                        maxAllowed: THRESHOLDS.MAX_WINS_PER_MINUTE
                    }
                });
            }
        } catch (err) {
            console.error('AntiCheat: Win frequency check failed:', err);
        }
    }

    /**
     * Check if player should be auto-banned.
     */
    async _checkAutoBan(playerId, tenantId) {
        try {
            const result = await db.query(`
                SELECT COUNT(*) as critical_flags FROM anticheat_flags
                WHERE player_id = $1 AND tenant_id = $2
                    AND severity = 'critical'
                    AND status = 'open'
                    AND created_at > NOW() - INTERVAL '${THRESHOLDS.AUTO_BAN_WINDOW_HOURS} hours'
            `, [playerId, tenantId]);

            const criticalFlags = parseInt(result.rows[0].critical_flags, 10);
            if (criticalFlags >= THRESHOLDS.AUTO_BAN_CRITICAL_FLAGS) {
                // Auto-ban: 24-hour temporary ban
                await db.query(`
                    UPDATE players SET is_banned = TRUE,
                        ban_expires_at = NOW() + INTERVAL '24 hours',
                        ban_reason = 'Auto-ban: multiple critical anti-cheat flags'
                    WHERE id = $1 AND tenant_id = $2
                `, [playerId, tenantId]);

                console.warn(`AntiCheat: Auto-banned player ${playerId} (${criticalFlags} critical flags)`);
            }
        } catch (err) {
            console.error('AntiCheat: Auto-ban check failed:', err);
        }
    }

    /**
     * Persist multiple flags to the database.
     */
    async _persistFlags(playerId, flags, matchId) {
        for (const flag of flags) {
            await this._persistFlag(playerId, 'stem_default', flag, matchId);
        }
    }

    /**
     * Persist a single flag to the database.
     */
    async _persistFlag(playerId, tenantId, flag, matchId) {
        try {
            await db.query(`
                INSERT INTO anticheat_flags (tenant_id, player_id, flag_type, severity, details, match_id)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [tenantId, playerId, flag.type, flag.severity, JSON.stringify(flag.details), matchId || null]);
        } catch (err) {
            console.error('AntiCheat: Failed to persist flag:', err);
        }
    }
}

module.exports = { AntiCheatService, THRESHOLDS };
