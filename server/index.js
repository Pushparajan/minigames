/**
 * STEM Adventures API Server
 * ===========================
 * Express server designed for SaaS scale (1M+ concurrent players).
 * Features: JWT auth, rate limiting, Redis caching, PostgreSQL persistence,
 * sharded leaderboards, batch sync, multi-tenant support.
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const config = require('./config');
const { rateLimiter } = require('./middleware/rateLimiter');
const { authenticate, optionalAuth } = require('./middleware/auth');
const { tenantResolver } = require('./middleware/tenant');
const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const scoreRoutes = require('./routes/scores');
const leaderboardRoutes = require('./routes/leaderboards');
const playerRoutes = require('./routes/player');
const syncRoutes = require('./routes/sync');
const billingRoutes = require('./routes/billing');
const organisationRoutes = require('./routes/organisations');
const webhookRoutes = require('./routes/webhooks');

const db = require('./models/db');
const cache = require('./services/cache');

const app = express();

// =========================================
// Serverless Connection Management
// =========================================
// Lazy-init DB and Redis on first request. Connections
// persist across warm invocations in serverless runtimes.

let _initialized = false;

async function ensureConnections() {
    if (_initialized) return;
    await db.init();
    await cache.init();
    _initialized = true;
}

app.use(async (req, res, next) => {
    try {
        await ensureConnections();
        next();
    } catch (err) {
        console.error('Connection init failed:', err);
        res.status(503).json({ error: 'Service starting up, please retry' });
    }
});

// =========================================
// Global Middleware
// =========================================

app.use(helmet());
app.use(compression());
app.use(cors({ origin: config.corsOrigins, credentials: true }));

// Stripe webhooks need raw body BEFORE json parser
app.use('/api/v1/webhooks', tenantResolver, webhookRoutes);

app.use(express.json({ limit: '1mb' }));
app.use(rateLimiter);
app.use(tenantResolver);

// =========================================
// Health Check
// =========================================

app.get('/api/v1/health', async (req, res) => {
    const dbHealthy = await db.healthCheck();
    const cacheHealthy = await cache.healthCheck();
    res.json({
        status: dbHealthy && cacheHealthy ? 'ok' : 'degraded',
        db: dbHealthy ? 'ok' : 'error',
        cache: cacheHealthy ? 'ok' : 'error',
        uptime: process.uptime(),
        timestamp: Date.now()
    });
});

// =========================================
// Routes
// =========================================

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/scores', authenticate, scoreRoutes);
app.use('/api/v1/leaderboards', optionalAuth, leaderboardRoutes);
app.use('/api/v1/player', authenticate, playerRoutes);
app.use('/api/v1/sync', authenticate, syncRoutes);
app.use('/api/v1/billing', authenticate, billingRoutes);
app.use('/api/v1/organisations', authenticate, organisationRoutes);

// =========================================
// Error Handling
// =========================================

app.use(errorHandler);

// =========================================
// Start Server (local dev only)
// =========================================

if (require.main === module) {
    (async () => {
        try {
            await ensureConnections();
            app.listen(config.port, () => {
                console.log(`STEM Adventures API running on port ${config.port} [${config.nodeEnv}]`);
            });
        } catch (err) {
            console.error('Failed to start server:', err);
            process.exit(1);
        }
    })();
}

module.exports = app;
