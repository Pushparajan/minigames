/**
 * Server Configuration
 * ====================
 * Centralized config from environment variables with sensible defaults.
 * Supports multi-tenant SaaS deployment.
 */

require('dotenv').config();

module.exports = {
    // Server
    port: parseInt(process.env.PORT, 10) || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    corsOrigins: process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',')
        : ['http://localhost:3000', 'http://localhost:8080'],

    // PostgreSQL
    db: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT, 10) || 5432,
        database: process.env.DB_NAME || 'stem_adventures',
        user: process.env.DB_USER || 'stem_admin',
        password: process.env.DB_PASSWORD || '',
        pool: {
            min: parseInt(process.env.DB_POOL_MIN, 10) || 5,
            max: parseInt(process.env.DB_POOL_MAX, 10) || 50
        }
    },

    // Redis
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT, 10) || 6379,
        password: process.env.REDIS_PASSWORD || '',
        db: parseInt(process.env.REDIS_DB, 10) || 0,
        keyPrefix: 'stem:'
    },

    // JWT
    jwt: {
        secret: process.env.JWT_SECRET || 'change-me-in-production',
        accessExpiry: process.env.JWT_ACCESS_EXPIRY || '1h',
        refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '30d'
    },

    // Rate Limiting
    rateLimit: {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
        scoreSubmitMax: parseInt(process.env.RATE_LIMIT_SCORE, 10) || 30
    },

    // Leaderboard
    leaderboard: {
        shardCount: parseInt(process.env.LEADERBOARD_SHARDS, 10) || 8,
        pageSize: parseInt(process.env.LEADERBOARD_PAGE_SIZE, 10) || 50,
        cacheSeconds: parseInt(process.env.LEADERBOARD_CACHE_SEC, 10) || 30
    },

    // Multi-tenancy
    tenant: {
        defaultTenantId: process.env.DEFAULT_TENANT_ID || 'stem_default',
        apiKeyHeader: 'x-api-key'
    },

    // Stripe
    stripe: {
        secretKey: process.env.STRIPE_SECRET_KEY || '',
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
        pricingTableId: process.env.STRIPE_PRICING_TABLE_ID || '',
        trialDays: parseInt(process.env.STRIPE_TRIAL_DAYS, 10) || 14,
        portalReturnUrl: process.env.STRIPE_PORTAL_RETURN_URL || '',
        defaultPriceIds: {
            starter: process.env.STRIPE_PRICE_STARTER || '',
            pro: process.env.STRIPE_PRICE_PRO || '',
            enterprise: process.env.STRIPE_PRICE_ENTERPRISE || ''
        }
    }
};
