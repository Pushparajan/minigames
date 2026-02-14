/**
 * SubscriptionSyncService
 * ========================
 * Synchronizes Stripe subscription state with the local database.
 * Called from webhook handlers and during direct API operations.
 *
 * Responsibilities:
 * - Create/update subscription records from Stripe events
 * - Provision/revoke entitlements based on plan tier
 * - Track trial usage and enforce one-trial-per-user
 * - Update organisation billing state
 */

const db = require('../models/db');
const cache = require('./cache');

// =========================================
// Plan → Entitlement Mapping
// =========================================

const PLAN_ENTITLEMENTS = {
    free: {
        max_members: 1,
        max_storage_mb: 100,
        max_games: 5,
        features: []
    },
    starter: {
        max_members: 10,
        max_storage_mb: 1024,
        max_games: 15,
        features: ['organisations', 'multiplayer', 'advanced_leaderboards']
    },
    pro: {
        max_members: 50,
        max_storage_mb: 10240,
        max_games: 25,
        features: [
            'organisations', 'multiplayer', 'analytics_dashboard',
            'custom_branding', 'api_access', 'advanced_leaderboards',
            'export_data', 'unlimited_games'
        ]
    },
    enterprise: {
        max_members: -1,  // unlimited
        max_storage_mb: -1,
        max_games: 25,
        features: [
            'organisations', 'multiplayer', 'analytics_dashboard',
            'custom_branding', 'api_access', 'priority_support',
            'advanced_leaderboards', 'export_data', 'unlimited_games'
        ]
    }
};

// All possible feature keys for revocation
const ALL_FEATURES = [
    'organisations', 'multiplayer', 'analytics_dashboard',
    'custom_branding', 'api_access', 'priority_support',
    'advanced_leaderboards', 'export_data', 'unlimited_games'
];

// =========================================
// Core Sync Operations
// =========================================

/**
 * Sync a Stripe subscription to the local DB and provision entitlements.
 *
 * @param {Object} stripeSubscription - Stripe subscription object
 * @param {string} tenantId
 * @returns {Object} Local subscription record
 */
async function syncFromStripe(stripeSubscription, tenantId) {
    const {
        id: stripeSubId,
        customer: customerId,
        status,
        items,
        trial_start,
        trial_end,
        current_period_start,
        current_period_end,
        cancel_at,
        canceled_at,
        ended_at,
        metadata
    } = stripeSubscription;

    const priceId = items?.data?.[0]?.price?.id || null;
    const planTier = _resolvePlanTier(priceId, metadata);

    // Find organisation by Stripe customer ID
    const orgResult = await db.query(
        'SELECT id FROM organisations WHERE stripe_customer_id = $1',
        [typeof customerId === 'string' ? customerId : customerId.id]
    );

    if (orgResult.rows.length === 0) {
        throw new Error(`No organisation found for Stripe customer ${customerId}`);
    }

    const organisationId = orgResult.rows[0].id;

    // Upsert subscription
    const subResult = await db.query(`
        INSERT INTO subscriptions (
            organisation_id, tenant_id, stripe_subscription_id, stripe_customer_id,
            stripe_price_id, status, plan_tier, trial_start, trial_end,
            current_period_start, current_period_end, cancel_at, canceled_at,
            ended_at, metadata, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
        ON CONFLICT (stripe_subscription_id) DO UPDATE SET
            status = EXCLUDED.status,
            plan_tier = EXCLUDED.plan_tier,
            stripe_price_id = EXCLUDED.stripe_price_id,
            trial_start = EXCLUDED.trial_start,
            trial_end = EXCLUDED.trial_end,
            current_period_start = EXCLUDED.current_period_start,
            current_period_end = EXCLUDED.current_period_end,
            cancel_at = EXCLUDED.cancel_at,
            canceled_at = EXCLUDED.canceled_at,
            ended_at = EXCLUDED.ended_at,
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
        RETURNING *
    `, [
        organisationId, tenantId, stripeSubId,
        typeof customerId === 'string' ? customerId : customerId.id,
        priceId, status, planTier,
        trial_start ? new Date(trial_start * 1000) : null,
        trial_end ? new Date(trial_end * 1000) : null,
        current_period_start ? new Date(current_period_start * 1000) : null,
        current_period_end ? new Date(current_period_end * 1000) : null,
        cancel_at ? new Date(cancel_at * 1000) : null,
        canceled_at ? new Date(canceled_at * 1000) : null,
        ended_at ? new Date(ended_at * 1000) : null,
        JSON.stringify(metadata || {})
    ]);

    const subscription = subResult.rows[0];

    // Provision or revoke entitlements based on status
    if (['active', 'trialing'].includes(status)) {
        await provisionEntitlements(organisationId, subscription.id, tenantId, planTier);
    } else if (['canceled', 'unpaid', 'incomplete_expired'].includes(status)) {
        await revokeEntitlements(organisationId, tenantId);
    }

    // Invalidate cached entitlements
    await cache.del(`entitlements:${organisationId}`);

    return subscription;
}

/**
 * Provision entitlements for a plan tier.
 */
async function provisionEntitlements(organisationId, subscriptionId, tenantId, planTier) {
    const plan = PLAN_ENTITLEMENTS[planTier] || PLAN_ENTITLEMENTS.free;

    // Revoke features not in this plan
    const enabledFeatures = new Set(plan.features);
    for (const feature of ALL_FEATURES) {
        if (enabledFeatures.has(feature)) {
            await db.query(`
                INSERT INTO entitlements (organisation_id, subscription_id, tenant_id, feature_key, is_enabled)
                VALUES ($1, $2, $3, $4, true)
                ON CONFLICT (organisation_id, feature_key) DO UPDATE SET
                    is_enabled = true,
                    subscription_id = EXCLUDED.subscription_id
            `, [organisationId, subscriptionId, tenantId, feature]);
        } else {
            await db.query(`
                INSERT INTO entitlements (organisation_id, subscription_id, tenant_id, feature_key, is_enabled)
                VALUES ($1, $2, $3, $4, false)
                ON CONFLICT (organisation_id, feature_key) DO UPDATE SET
                    is_enabled = false
            `, [organisationId, subscriptionId, tenantId, feature]);
        }
    }

    // Set numeric limits
    await _setLimitEntitlement(organisationId, subscriptionId, tenantId, 'max_members', plan.max_members);
    await _setLimitEntitlement(organisationId, subscriptionId, tenantId, 'max_storage_mb', plan.max_storage_mb);
    await _setLimitEntitlement(organisationId, subscriptionId, tenantId, 'max_games', plan.max_games);
}

/**
 * Revoke all entitlements (downgrade to free).
 */
async function revokeEntitlements(organisationId, tenantId) {
    return provisionEntitlements(organisationId, null, tenantId, 'free');
}

/**
 * Get the effective plan tier for an organisation.
 */
async function getEffectivePlan(organisationId) {
    const result = await db.query(`
        SELECT plan_tier, status FROM subscriptions
        WHERE organisation_id = $1 AND status IN ('active', 'trialing')
        ORDER BY created_at DESC LIMIT 1
    `, [organisationId]);

    if (result.rows.length === 0) return 'free';
    return result.rows[0].plan_tier;
}

/**
 * Check if a user has already used their trial.
 */
async function hasUsedTrial(playerId, tenantId) {
    const result = await db.query(
        'SELECT 1 FROM trial_history WHERE player_id = $1 AND tenant_id = $2',
        [playerId, tenantId]
    );
    return result.rows.length > 0;
}

/**
 * Record that a user started a trial.
 */
async function recordTrialStart(playerId, tenantId, organisationId) {
    await db.query(`
        INSERT INTO trial_history (player_id, tenant_id, organisation_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (player_id, tenant_id) DO NOTHING
    `, [playerId, tenantId, organisationId]);
}

/**
 * Mark a trial as converted (user paid).
 */
async function markTrialConverted(playerId, tenantId) {
    await db.query(`
        UPDATE trial_history SET converted = true, trial_ended_at = NOW()
        WHERE player_id = $1 AND tenant_id = $2
    `, [playerId, tenantId]);
}

// =========================================
// Internal Helpers
// =========================================

function _resolvePlanTier(priceId, metadata) {
    // Check metadata override first
    if (metadata?.plan_tier) return metadata.plan_tier;

    // Map Stripe price IDs to plan tiers (configured per tenant)
    // In production, look up from plan_definitions table
    // Fallback: parse from metadata or default to 'free'
    return 'free';
}

async function _setLimitEntitlement(organisationId, subscriptionId, tenantId, featureKey, limitValue) {
    await db.query(`
        INSERT INTO entitlements (organisation_id, subscription_id, tenant_id, feature_key, is_enabled, limit_value)
        VALUES ($1, $2, $3, $4, true, $5)
        ON CONFLICT (organisation_id, feature_key) DO UPDATE SET
            is_enabled = true,
            limit_value = EXCLUDED.limit_value,
            subscription_id = EXCLUDED.subscription_id
    `, [organisationId, subscriptionId, tenantId, featureKey, limitValue === -1 ? null : limitValue]);
}

module.exports = {
    syncFromStripe,
    provisionEntitlements,
    revokeEntitlements,
    getEffectivePlan,
    hasUsedTrial,
    recordTrialStart,
    markTrialConverted,
    PLAN_ENTITLEMENTS,
    ALL_FEATURES
};
