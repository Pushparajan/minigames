/**
 * Authentication Routes
 * ======================
 * POST /auth/guest    - Register/login as guest
 * POST /auth/register - Create full account
 * POST /auth/login    - Login with email/password
 * POST /auth/refresh  - Refresh JWT token
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../models/db');
const { generateTokens } = require('../middleware/auth');

const router = express.Router();

/**
 * Guest registration — creates a session without email/password.
 * If playerId already exists, returns existing session.
 */
router.post('/guest', async (req, res, next) => {
    try {
        const { playerId, displayName, avatarCharacter } = req.body;
        const tenantId = req.tenantId;
        const id = playerId || uuidv4();

        // Upsert guest player
        const result = await db.query(`
            INSERT INTO players (id, tenant_id, display_name, avatar_character, is_guest)
            VALUES ($1, $2, $3, $4, true)
            ON CONFLICT (id, tenant_id) DO UPDATE
                SET last_login_at = NOW(),
                    display_name = COALESCE(EXCLUDED.display_name, players.display_name)
            RETURNING id, display_name, avatar_character, is_guest, total_score, games_played, created_at
        `, [id, tenantId, displayName || 'Explorer', avatarCharacter || 'guha']);

        const player = result.rows[0];
        const tokens = generateTokens(player.id, tenantId);

        res.json({
            token: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            player: _formatPlayer(player)
        });
    } catch (err) {
        next(err);
    }
});

/**
 * Full account registration.
 */
router.post('/register', async (req, res, next) => {
    try {
        const { email, password, displayName, playerId, avatarCharacter } = req.body;
        const tenantId = req.tenantId;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        // Check if email already exists for this tenant
        const existing = await db.query(
            'SELECT id FROM players WHERE email = $1 AND tenant_id = $2',
            [email, tenantId]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const id = playerId || uuidv4();

        // If guest player exists, upgrade to full account
        const result = await db.query(`
            INSERT INTO players (id, tenant_id, email, password_hash, display_name, avatar_character, is_guest)
            VALUES ($1, $2, $3, $4, $5, $6, false)
            ON CONFLICT (id, tenant_id) DO UPDATE
                SET email = EXCLUDED.email,
                    password_hash = EXCLUDED.password_hash,
                    is_guest = false,
                    display_name = COALESCE(EXCLUDED.display_name, players.display_name)
            RETURNING id, display_name, avatar_character, is_guest, total_score, games_played, created_at
        `, [id, tenantId, email, passwordHash, displayName || 'Explorer', avatarCharacter || 'guha']);

        const player = result.rows[0];
        const tokens = generateTokens(player.id, tenantId);

        res.status(201).json({
            token: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            player: _formatPlayer(player)
        });
    } catch (err) {
        next(err);
    }
});

/**
 * Login with email/password.
 */
router.post('/login', async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const tenantId = req.tenantId;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const result = await db.query(
            'SELECT * FROM players WHERE email = $1 AND tenant_id = $2',
            [email, tenantId]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const player = result.rows[0];
        const valid = await bcrypt.compare(password, player.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        await db.query(
            'UPDATE players SET last_login_at = NOW() WHERE id = $1 AND tenant_id = $2',
            [player.id, tenantId]
        );

        const tokens = generateTokens(player.id, tenantId);

        // Fetch player progress for client merge
        const progress = await _getPlayerProgress(player.id, tenantId);

        res.json({
            token: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            player: _formatPlayer(player),
            playerData: {
                player: _formatPlayer(player),
                progress
            }
        });
    } catch (err) {
        next(err);
    }
});

/**
 * Refresh JWT token.
 */
router.post('/refresh', async (req, res, next) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({ error: 'Refresh token required' });
        }

        const jwt = require('jsonwebtoken');
        const config = require('../config');

        const decoded = jwt.verify(refreshToken, config.jwt.secret);
        if (decoded.type !== 'refresh') {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        const tokens = generateTokens(decoded.playerId, decoded.tenantId);
        res.json({
            token: tokens.accessToken,
            refreshToken: tokens.refreshToken
        });
    } catch (err) {
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }
        next(err);
    }
});

// =========================================
// Helpers
// =========================================

function _formatPlayer(row) {
    return {
        playerId: row.id,
        displayName: row.display_name,
        avatarCharacter: row.avatar_character,
        isGuest: row.is_guest,
        totalScore: parseInt(row.total_score, 10) || 0,
        gamesPlayed: parseInt(row.games_played, 10) || 0,
        createdAt: row.created_at
    };
}

async function _getPlayerProgress(playerId, tenantId) {
    const result = await db.query(
        'SELECT * FROM game_progress WHERE player_id = $1 AND tenant_id = $2',
        [playerId, tenantId]
    );

    const progress = {};
    for (const row of result.rows) {
        progress[row.game_id] = {
            highScore: parseInt(row.high_score, 10),
            bestTime: row.best_time ? parseInt(row.best_time, 10) : null,
            level: row.level,
            stars: row.stars,
            playCount: row.play_count,
            totalScore: parseInt(row.total_score, 10),
            lastPlayed: row.last_played_at
        };
    }
    return progress;
}

module.exports = router;
