/**
 * Rate Limiting Middleware
 * ========================
 * Protects the API from abuse. Uses express-rate-limit with
 * configurable windows for general and score submission endpoints.
 */

const rateLimit = require('express-rate-limit');
const config = require('../config');

const rateLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Use player ID if authenticated, otherwise IP
        return req.player?.id || req.ip;
    },
    message: {
        error: 'Too many requests',
        retryAfter: Math.ceil(config.rateLimit.windowMs / 1000)
    }
});

const scoreRateLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.scoreSubmitMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return `score:${req.player?.id || req.ip}`;
    },
    message: {
        error: 'Score submission rate limit exceeded',
        retryAfter: Math.ceil(config.rateLimit.windowMs / 1000)
    }
});

module.exports = { rateLimiter, scoreRateLimiter };
