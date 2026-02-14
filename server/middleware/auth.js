/**
 * JWT Authentication Middleware
 * ==============================
 * Verifies JWT tokens and attaches player data to req.player.
 * Supports both required and optional auth modes.
 */

const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Required authentication — rejects if no valid token.
 */
function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.slice(7);
    try {
        const decoded = jwt.verify(token, config.jwt.secret);
        req.player = {
            id: decoded.playerId,
            tenantId: decoded.tenantId || req.tenantId,
            role: decoded.role || 'player'
        };
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
        }
        return res.status(401).json({ error: 'Invalid token' });
    }
}

/**
 * Optional authentication — continues even without a token.
 */
function optionalAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        req.player = null;
        return next();
    }

    const token = authHeader.slice(7);
    try {
        const decoded = jwt.verify(token, config.jwt.secret);
        req.player = {
            id: decoded.playerId,
            tenantId: decoded.tenantId || req.tenantId,
            role: decoded.role || 'player'
        };
    } catch {
        req.player = null;
    }
    next();
}

/**
 * Generate JWT tokens for a player.
 */
function generateTokens(playerId, tenantId) {
    const accessToken = jwt.sign(
        { playerId, tenantId },
        config.jwt.secret,
        { expiresIn: config.jwt.accessExpiry }
    );

    const refreshToken = jwt.sign(
        { playerId, tenantId, type: 'refresh' },
        config.jwt.secret,
        { expiresIn: config.jwt.refreshExpiry }
    );

    return { accessToken, refreshToken };
}

module.exports = { authenticate, optionalAuth, generateTokens };
