/**
 * Usage Meter Service
 * ====================
 * Tracks metered usage (API calls, game sessions, data exports)
 * with monthly billing periods and configurable limits.
 *
 * Meters reset at the start of each billing period.
 * Limits are enforced via the entitlements middleware.
 */

const db = require('../models/db');
const cache = require('./cache');

const METER_CACHE_TTL = 60; // seconds

/**
 * Meter limit defaults per plan tier.
 */
const METER_LIMITS = {
    free: {
        api_calls: 1000,
        game_sessions: 500,
        data_exports: 5
    },
    starter: {
        api_calls: 50000,
        game_sessions: 10000,
        data_exports: 50
    },
    pro: {
        api_calls: 500000,
        game_sessions: 100000,
        data_exports: 500
    },
    enterprise: {
        api_calls: null,   // unlimited
        game_sessions: null,
        data_exports: null
    }
};

/**
 * Increment a usage meter.
 *
 * @param {string} organisationId
 * @param {string} tenantId
 * @param {string} meterKey - 'api_calls', 'game_sessions', 'data_exports'
 * @param {number} amount - Amount to increment (default 1)
 * @returns {Object} { count, limit, remaining }
 */
async function increment(organisationId, tenantId, meterKey, amount = 1) {
    const period = _getCurrentPeriod();

    // Get or create the meter for this period
    const result = await db.query(`
        INSERT INTO usage_meters (organisation_id, tenant_id, meter_key, period_start, period_end, count, limit_value)
        VALUES ($1, $2, $3, $4, $5, $6, (
            SELECT CASE
                WHEN s.plan_tier = 'enterprise' THEN NULL
                ELSE (
                    SELECT CASE $3
                        WHEN 'api_calls' THEN
                            CASE s.plan_tier WHEN 'pro' THEN 500000 WHEN 'starter' THEN 50000 ELSE 1000 END
                        WHEN 'game_sessions' THEN
                            CASE s.plan_tier WHEN 'pro' THEN 100000 WHEN 'starter' THEN 10000 ELSE 500 END
                        WHEN 'data_exports' THEN
                            CASE s.plan_tier WHEN 'pro' THEN 500 WHEN 'starter' THEN 50 ELSE 5 END
                        ELSE 1000
                    END
                )
            END
            FROM subscriptions s
            WHERE s.organisation_id = $1 AND s.status IN ('active', 'trialing')
            ORDER BY s.created_at DESC LIMIT 1
        ))
        ON CONFLICT (organisation_id, meter_key, period_start) DO UPDATE SET
            count = usage_meters.count + $6
        RETURNING count, limit_value, period_end
    `, [organisationId, tenantId, meterKey, period.start, period.end, amount]);

    const row = result.rows[0];
    const count = parseInt(row.count, 10);
    const limit = row.limit_value !== null ? parseInt(row.limit_value, 10) : null;

    // Invalidate cache
    await cache.del(`meter:${organisationId}:${meterKey}`);

    return {
        count,
        limit,
        remaining: limit !== null ? Math.max(0, limit - count) : null,
        periodEnd: row.period_end
    };
}

/**
 * Get current meter status without incrementing.
 */
async function getStatus(organisationId, tenantId, meterKey) {
    const cacheKey = `meter:${organisationId}:${meterKey}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const period = _getCurrentPeriod();

    const result = await db.query(`
        SELECT count, limit_value, period_end FROM usage_meters
        WHERE organisation_id = $1 AND tenant_id = $2 AND meter_key = $3
            AND period_start = $4
    `, [organisationId, tenantId, meterKey, period.start]);

    let status;
    if (result.rows.length === 0) {
        status = { count: 0, limit: null, remaining: null, periodEnd: period.end };
    } else {
        const row = result.rows[0];
        const count = parseInt(row.count, 10);
        const limit = row.limit_value !== null ? parseInt(row.limit_value, 10) : null;
        status = {
            count,
            limit,
            remaining: limit !== null ? Math.max(0, limit - count) : null,
            periodEnd: row.period_end
        };
    }

    await cache.set(cacheKey, status, METER_CACHE_TTL);
    return status;
}

/**
 * Get all meter statuses for an organisation.
 */
async function getAllStatuses(organisationId, tenantId) {
    const keys = ['api_calls', 'game_sessions', 'data_exports'];
    const statuses = {};
    for (const key of keys) {
        statuses[key] = await getStatus(organisationId, tenantId, key);
    }
    return statuses;
}

/**
 * Check if a meter has remaining quota.
 */
async function hasQuota(organisationId, tenantId, meterKey, amount = 1) {
    const status = await getStatus(organisationId, tenantId, meterKey);
    if (status.limit === null) return true; // unlimited
    return status.count + amount <= status.limit;
}

/**
 * Reset all meters for an organisation (e.g., on plan change).
 */
async function resetMeters(organisationId, tenantId) {
    const period = _getCurrentPeriod();
    await db.query(`
        DELETE FROM usage_meters
        WHERE organisation_id = $1 AND tenant_id = $2 AND period_start = $3
    `, [organisationId, tenantId, period.start]);

    // Clear cache
    for (const key of ['api_calls', 'game_sessions', 'data_exports']) {
        await cache.del(`meter:${organisationId}:${key}`);
    }
}

// =========================================
// Internal
// =========================================

function _getCurrentPeriod() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { start, end };
}

module.exports = {
    increment,
    getStatus,
    getAllStatuses,
    hasQuota,
    resetMeters,
    METER_LIMITS
};
