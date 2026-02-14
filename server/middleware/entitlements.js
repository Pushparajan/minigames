/**
 * Entitlement Enforcement Middleware
 * ====================================
 * Controller-level middleware for feature gating.
 * Checks if the requesting player's organisation has the
 * required entitlement before allowing access.
 *
 * Usage in routes:
 *   router.get('/analytics', requireEntitlement('analytics_dashboard'), handler)
 *   router.post('/org', requireEntitlement('organisations'), handler)
 *   router.post('/export', requireUsageQuota('data_exports', 1), handler)
 */

const db = require('../models/db');
const cache = require('../services/cache');

const ENTITLEMENT_CACHE_TTL = 120; // seconds

/**
 * Require a specific feature entitlement.
 * Resolves the player's active organisation and checks the feature.
 *
 * @param {string} featureKey - The feature key to check
 * @returns {Function} Express middleware
 */
function requireEntitlement(featureKey) {
    return async (req, res, next) => {
        try {
            const playerId = req.player?.id;
            const tenantId = req.player?.tenantId || req.tenantId;

            if (!playerId) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            // Get player's organisation(s)
            const orgId = req.params.orgId || req.body?.organisationId || req.query?.orgId;
            const org = await _resolveOrganisation(playerId, tenantId, orgId);

            if (!org) {
                return res.status(403).json({
                    error: 'No active organisation',
                    code: 'NO_ORGANISATION',
                    upgrade: true
                });
            }

            // Check entitlement
            const entitled = await checkEntitlement(org.id, featureKey);

            if (!entitled) {
                return res.status(403).json({
                    error: `Feature '${featureKey}' requires a plan upgrade`,
                    code: 'ENTITLEMENT_REQUIRED',
                    feature: featureKey,
                    upgrade: true
                });
            }

            // Attach org to request for downstream use
            req.organisation = org;
            next();
        } catch (err) {
            next(err);
        }
    };
}

/**
 * Require a numeric limit entitlement (e.g., max_members, max_storage_mb).
 * Compares current usage against the limit.
 *
 * @param {string} featureKey - The limit feature key
 * @param {number} requestedAmount - How much is being requested
 * @returns {Function} Express middleware
 */
function requireLimit(featureKey, requestedAmount = 1) {
    return async (req, res, next) => {
        try {
            const playerId = req.player?.id;
            const tenantId = req.player?.tenantId || req.tenantId;

            if (!playerId) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            const orgId = req.params.orgId || req.body?.organisationId || req.query?.orgId;
            const org = await _resolveOrganisation(playerId, tenantId, orgId);

            if (!org) {
                return res.status(403).json({
                    error: 'No active organisation',
                    code: 'NO_ORGANISATION',
                    upgrade: true
                });
            }

            const limit = await getLimit(org.id, featureKey);

            if (limit !== null) {
                const currentUsage = await getCurrentUsage(org.id, featureKey);
                if (currentUsage + requestedAmount > limit) {
                    return res.status(403).json({
                        error: `${featureKey} limit reached (${currentUsage}/${limit})`,
                        code: 'LIMIT_EXCEEDED',
                        feature: featureKey,
                        current: currentUsage,
                        limit,
                        upgrade: true
                    });
                }
            }

            req.organisation = org;
            next();
        } catch (err) {
            next(err);
        }
    };
}

/**
 * Require a usage meter to have remaining quota.
 *
 * @param {string} meterKey - The meter key (e.g., 'api_calls')
 * @param {number} amount - Amount to consume
 * @returns {Function} Express middleware
 */
function requireUsageQuota(meterKey, amount = 1) {
    return async (req, res, next) => {
        try {
            const playerId = req.player?.id;
            const tenantId = req.player?.tenantId || req.tenantId;

            if (!playerId) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            const orgId = req.params.orgId || req.body?.organisationId || req.query?.orgId;
            const org = await _resolveOrganisation(playerId, tenantId, orgId);

            if (!org) {
                return res.status(403).json({ error: 'No active organisation', code: 'NO_ORGANISATION' });
            }

            const meter = await _getCurrentMeter(org.id, tenantId, meterKey);
            if (meter && meter.limit_value !== null) {
                if (parseInt(meter.count, 10) + amount > parseInt(meter.limit_value, 10)) {
                    return res.status(429).json({
                        error: `Usage limit for '${meterKey}' exceeded`,
                        code: 'USAGE_LIMIT_EXCEEDED',
                        meter: meterKey,
                        current: parseInt(meter.count, 10),
                        limit: parseInt(meter.limit_value, 10),
                        resetsAt: meter.period_end,
                        upgrade: true
                    });
                }
            }

            req.organisation = org;
            next();
        } catch (err) {
            next(err);
        }
    };
}

// =========================================
// Entitlement Queries
// =========================================

/**
 * Check if an organisation has a boolean feature entitlement.
 */
async function checkEntitlement(organisationId, featureKey) {
    // Check cache first
    const cacheKey = `entitlements:${organisationId}`;
    let entitlements = await cache.get(cacheKey);

    if (!entitlements) {
        const result = await db.query(
            'SELECT feature_key, is_enabled, limit_value FROM entitlements WHERE organisation_id = $1',
            [organisationId]
        );
        entitlements = {};
        for (const row of result.rows) {
            entitlements[row.feature_key] = {
                enabled: row.is_enabled,
                limit: row.limit_value
            };
        }
        await cache.set(cacheKey, entitlements, ENTITLEMENT_CACHE_TTL);
    }

    const ent = entitlements[featureKey];
    return ent ? ent.enabled : false;
}

/**
 * Get the numeric limit for a feature.
 * Returns null for unlimited.
 */
async function getLimit(organisationId, featureKey) {
    const cacheKey = `entitlements:${organisationId}`;
    let entitlements = await cache.get(cacheKey);

    if (!entitlements) {
        const result = await db.query(
            'SELECT feature_key, is_enabled, limit_value FROM entitlements WHERE organisation_id = $1',
            [organisationId]
        );
        entitlements = {};
        for (const row of result.rows) {
            entitlements[row.feature_key] = {
                enabled: row.is_enabled,
                limit: row.limit_value
            };
        }
        await cache.set(cacheKey, entitlements, ENTITLEMENT_CACHE_TTL);
    }

    const ent = entitlements[featureKey];
    return ent ? ent.limit : 0;
}

/**
 * Get current usage for a limit entitlement.
 */
async function getCurrentUsage(organisationId, featureKey) {
    switch (featureKey) {
        case 'max_members': {
            const result = await db.query(
                'SELECT COUNT(*) FROM organisation_members WHERE organisation_id = $1',
                [organisationId]
            );
            return parseInt(result.rows[0].count, 10);
        }
        case 'max_storage_mb': {
            const result = await db.query(
                'SELECT COALESCE(SUM(size_bytes), 0) as total FROM storage_usage WHERE organisation_id = $1',
                [organisationId]
            );
            return Math.ceil(parseInt(result.rows[0].total, 10) / (1024 * 1024));
        }
        case 'max_games': {
            const result = await db.query(
                'SELECT COUNT(DISTINCT game_id) FROM game_progress gp JOIN organisation_members om ON gp.player_id = om.player_id WHERE om.organisation_id = $1',
                [organisationId]
            );
            return parseInt(result.rows[0].count, 10);
        }
        default:
            return 0;
    }
}

/**
 * Get all entitlements for an organisation (for UI display).
 */
async function getAllEntitlements(organisationId) {
    const result = await db.query(
        'SELECT feature_key, is_enabled, limit_value, usage_count FROM entitlements WHERE organisation_id = $1',
        [organisationId]
    );

    const entitlements = {};
    for (const row of result.rows) {
        entitlements[row.feature_key] = {
            enabled: row.is_enabled,
            limit: row.limit_value,
            usage: row.usage_count
        };
    }
    return entitlements;
}

// =========================================
// Internal
// =========================================

async function _resolveOrganisation(playerId, tenantId, explicitOrgId) {
    if (explicitOrgId) {
        // Verify player is a member
        const result = await db.query(
            'SELECT o.* FROM organisations o JOIN organisation_members om ON o.id = om.organisation_id WHERE o.id = $1 AND om.player_id = $2',
            [explicitOrgId, playerId]
        );
        return result.rows[0] || null;
    }

    // Default: get player's first organisation
    const result = await db.query(`
        SELECT o.* FROM organisations o
        JOIN organisation_members om ON o.id = om.organisation_id
        WHERE om.player_id = $1 AND om.tenant_id = $2
        ORDER BY om.joined_at ASC LIMIT 1
    `, [playerId, tenantId]);

    return result.rows[0] || null;
}

async function _getCurrentMeter(organisationId, tenantId, meterKey) {
    const now = new Date();
    const result = await db.query(`
        SELECT * FROM usage_meters
        WHERE organisation_id = $1 AND tenant_id = $2 AND meter_key = $3
            AND period_start <= $4 AND period_end > $4
        ORDER BY period_start DESC LIMIT 1
    `, [organisationId, tenantId, meterKey, now]);

    return result.rows[0] || null;
}

module.exports = {
    requireEntitlement,
    requireLimit,
    requireUsageQuota,
    checkEntitlement,
    getLimit,
    getCurrentUsage,
    getAllEntitlements
};
