/**
 * Billing Routes
 * ===============
 * Manages subscriptions, billing portal, pricing table,
 * trial creation, and upgrade flows.
 *
 * POST /billing/subscribe            - Create a new subscription (or trial)
 * POST /billing/portal               - Get Stripe billing portal URL
 * GET  /billing/plans                 - List available plans and pricing table
 * GET  /billing/status                - Current subscription status
 * POST /billing/cancel                - Cancel subscription
 * POST /billing/resume                - Resume canceled subscription
 * GET  /billing/usage                 - Usage meters and storage
 * GET  /billing/entitlements          - All entitlements for the org
 * GET  /billing/upgrade-badge         - Check if upgrade badge should show
 */

const express = require('express');
const db = require('../models/db');
const stripeService = require('../services/stripe');
const subscriptionSync = require('../services/subscriptionSync');
const usageMeters = require('../services/usageMeters');
const storageQuotas = require('../services/storageQuotas');
const { getAllEntitlements } = require('../middleware/entitlements');
const config = require('../config');

const router = express.Router();

// =========================================
// Subscribe / Start Trial
// =========================================

/**
 * Create a subscription or start a trial.
 *
 * Body:
 *   organisationId: string
 *   planTier: 'starter' | 'pro' | 'enterprise'
 *   trial: boolean (optional, default false)
 */
router.post('/subscribe', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const { organisationId, planTier, trial } = req.body;

        if (!organisationId || !planTier) {
            return res.status(400).json({ error: 'organisationId and planTier required' });
        }

        // Verify player owns this organisation
        const orgResult = await db.query(
            'SELECT * FROM organisations WHERE id = $1 AND owner_id = $2',
            [organisationId, playerId]
        );
        if (orgResult.rows.length === 0) {
            return res.status(403).json({ error: 'Not the organisation owner' });
        }
        const org = orgResult.rows[0];

        // Check for existing active subscription
        const existingSub = await db.query(
            "SELECT id FROM subscriptions WHERE organisation_id = $1 AND status IN ('active', 'trialing')",
            [organisationId]
        );
        if (existingSub.rows.length > 0) {
            return res.status(409).json({ error: 'Organisation already has an active subscription' });
        }

        // Trial: enforce one-per-user limit
        if (trial) {
            const usedTrial = await subscriptionSync.hasUsedTrial(playerId, tenantId);
            if (usedTrial) {
                return res.status(409).json({
                    error: 'You have already used your free trial',
                    code: 'TRIAL_ALREADY_USED'
                });
            }
        }

        // Resolve plan price
        const planResult = await db.query(
            'SELECT * FROM plan_definitions WHERE tenant_id = $1 AND plan_tier = $2 AND is_active = true',
            [tenantId, planTier]
        );
        if (planResult.rows.length === 0) {
            return res.status(404).json({ error: 'Plan not found' });
        }
        const plan = planResult.rows[0];

        // Create or retrieve Stripe customer
        let stripeCustomerId = org.stripe_customer_id;
        if (!stripeCustomerId) {
            const playerResult = await db.query(
                'SELECT email, display_name FROM players WHERE id = $1 AND tenant_id = $2',
                [playerId, tenantId]
            );
            const player = playerResult.rows[0];

            const customer = await stripeService.createCustomer({
                email: player.email || `${playerId}@guests.stemadventures.com`,
                name: `${player.display_name} (${org.name})`,
                metadata: { organisationId, tenantId, playerId }
            });
            stripeCustomerId = customer.id;

            await db.query(
                'UPDATE organisations SET stripe_customer_id = $1 WHERE id = $2',
                [stripeCustomerId, organisationId]
            );
        }

        // Create Stripe subscription
        const trialDays = trial ? (config.stripe.trialDays || 14) : 0;
        const priceId = plan.stripe_price_id || config.stripe.defaultPriceIds?.[planTier];

        if (!priceId) {
            return res.status(400).json({ error: 'No Stripe price configured for this plan' });
        }

        const stripeSub = await stripeService.createSubscription({
            customerId: stripeCustomerId,
            priceId,
            trialDays,
            metadata: { organisationId, tenantId, planTier }
        });

        // Sync to local DB and provision entitlements
        const localSub = await subscriptionSync.syncFromStripe(stripeSub, tenantId);

        // Record trial if applicable
        if (trial) {
            await subscriptionSync.recordTrialStart(playerId, tenantId, organisationId);
        }

        res.status(201).json({
            subscription: {
                id: localSub.id,
                status: localSub.status,
                planTier: localSub.plan_tier,
                trialEnd: localSub.trial_end,
                currentPeriodEnd: localSub.current_period_end
            },
            clientSecret: stripeSub.latest_invoice?.payment_intent?.client_secret || null,
            stripeSubscriptionId: stripeSub.id
        });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Billing Portal
// =========================================

/**
 * Generate a Stripe billing portal URL for self-service management.
 */
router.post('/portal', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const { organisationId } = req.body;
        const returnUrl = req.body.returnUrl || config.stripe.portalReturnUrl || `${req.protocol}://${req.get('host')}/`;

        const orgResult = await db.query(
            'SELECT stripe_customer_id FROM organisations WHERE id = $1 AND owner_id = $2',
            [organisationId, playerId]
        );
        if (orgResult.rows.length === 0 || !orgResult.rows[0].stripe_customer_id) {
            return res.status(404).json({ error: 'No billing account found' });
        }

        const session = await stripeService.createBillingPortalSession(
            orgResult.rows[0].stripe_customer_id,
            returnUrl
        );

        res.json({ url: session.url });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Pricing Table / Plans
// =========================================

/**
 * List available plans with pricing and features.
 * Supports Stripe Pricing Table integration.
 */
router.get('/plans', async (req, res, next) => {
    try {
        const tenantId = req.player?.tenantId || req.tenantId;

        const result = await db.query(
            'SELECT * FROM plan_definitions WHERE tenant_id = $1 AND is_active = true ORDER BY sort_order ASC',
            [tenantId]
        );

        const plans = result.rows.map(row => ({
            id: row.id,
            tier: row.plan_tier,
            name: row.name,
            priceCents: row.price_cents,
            billingPeriod: row.billing_period,
            maxMembers: row.max_members,
            maxStorageMb: row.max_storage_mb,
            maxGames: row.max_games,
            features: row.features_json,
            stripePriceId: row.stripe_price_id
        }));

        res.json({
            plans,
            stripePricingTableId: config.stripe.pricingTableId || null,
            stripePublishableKey: config.stripe.publishableKey || null
        });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Subscription Status
// =========================================

/**
 * Get current subscription status for an organisation.
 */
router.get('/status', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const orgId = req.query.orgId;

        // Resolve org
        let orgQuery;
        if (orgId) {
            orgQuery = await db.query(
                'SELECT o.* FROM organisations o JOIN organisation_members om ON o.id = om.organisation_id WHERE o.id = $1 AND om.player_id = $2',
                [orgId, playerId]
            );
        } else {
            orgQuery = await db.query(
                'SELECT o.* FROM organisations o JOIN organisation_members om ON o.id = om.organisation_id WHERE om.player_id = $1 AND om.tenant_id = $2 ORDER BY om.joined_at LIMIT 1',
                [playerId, tenantId]
            );
        }

        if (orgQuery.rows.length === 0) {
            return res.json({
                hasOrganisation: false,
                subscription: null,
                plan: 'free',
                trialAvailable: !(await subscriptionSync.hasUsedTrial(playerId, tenantId))
            });
        }

        const org = orgQuery.rows[0];

        const subResult = await db.query(`
            SELECT * FROM subscriptions
            WHERE organisation_id = $1 AND status IN ('active', 'trialing', 'past_due')
            ORDER BY created_at DESC LIMIT 1
        `, [org.id]);

        const subscription = subResult.rows[0];
        const trialAvailable = !(await subscriptionSync.hasUsedTrial(playerId, tenantId));

        res.json({
            hasOrganisation: true,
            organisationId: org.id,
            organisationName: org.name,
            subscription: subscription ? {
                id: subscription.id,
                status: subscription.status,
                planTier: subscription.plan_tier,
                trialEnd: subscription.trial_end,
                currentPeriodEnd: subscription.current_period_end,
                cancelAt: subscription.cancel_at
            } : null,
            plan: subscription ? subscription.plan_tier : 'free',
            trialAvailable
        });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Cancel / Resume
// =========================================

router.post('/cancel', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const { organisationId, immediate } = req.body;

        const subResult = await db.query(`
            SELECT s.* FROM subscriptions s
            JOIN organisations o ON o.id = s.organisation_id
            WHERE s.organisation_id = $1 AND o.owner_id = $2
                AND s.status IN ('active', 'trialing')
            ORDER BY s.created_at DESC LIMIT 1
        `, [organisationId, playerId]);

        if (subResult.rows.length === 0) {
            return res.status(404).json({ error: 'No active subscription found' });
        }

        const sub = subResult.rows[0];
        const stripeSub = await stripeService.cancelSubscription(
            sub.stripe_subscription_id,
            { immediate: !!immediate }
        );

        const localSub = await subscriptionSync.syncFromStripe(stripeSub, req.player.tenantId);

        res.json({
            status: localSub.status,
            cancelAt: localSub.cancel_at,
            message: immediate
                ? 'Subscription canceled immediately'
                : 'Subscription will cancel at end of billing period'
        });
    } catch (err) {
        next(err);
    }
});

router.post('/resume', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const { organisationId } = req.body;

        const subResult = await db.query(`
            SELECT s.* FROM subscriptions s
            JOIN organisations o ON o.id = s.organisation_id
            WHERE s.organisation_id = $1 AND o.owner_id = $2
                AND s.cancel_at IS NOT NULL AND s.status = 'active'
            ORDER BY s.created_at DESC LIMIT 1
        `, [organisationId, playerId]);

        if (subResult.rows.length === 0) {
            return res.status(404).json({ error: 'No subscription pending cancellation' });
        }

        const sub = subResult.rows[0];
        const stripeSub = await stripeService.resumeSubscription(sub.stripe_subscription_id);
        const localSub = await subscriptionSync.syncFromStripe(stripeSub, req.player.tenantId);

        res.json({ status: localSub.status, message: 'Subscription resumed' });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Usage & Storage
// =========================================

router.get('/usage', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const orgId = req.query.orgId;

        const orgResult = await db.query(
            'SELECT o.id FROM organisations o JOIN organisation_members om ON o.id = om.organisation_id WHERE (o.id = $1 OR $1 IS NULL) AND om.player_id = $2 AND om.tenant_id = $3 ORDER BY om.joined_at LIMIT 1',
            [orgId || null, playerId, tenantId]
        );

        if (orgResult.rows.length === 0) {
            return res.json({ meters: {}, storage: {} });
        }

        const org = orgResult.rows[0];

        const [meters, storageBreakdown, storageTotalBytes] = await Promise.all([
            usageMeters.getAllStatuses(org.id, tenantId),
            storageQuotas.getUsageBreakdown(org.id),
            storageQuotas.getTotalUsage(org.id)
        ]);

        res.json({
            organisationId: org.id,
            meters,
            storage: {
                totalBytes: storageTotalBytes,
                totalMb: Math.round(storageTotalBytes / (1024 * 1024) * 100) / 100,
                breakdown: storageBreakdown
            }
        });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Entitlements
// =========================================

router.get('/entitlements', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const orgId = req.query.orgId;

        const orgResult = await db.query(
            'SELECT o.id FROM organisations o JOIN organisation_members om ON o.id = om.organisation_id WHERE (o.id = $1 OR $1 IS NULL) AND om.player_id = $2 AND om.tenant_id = $3 ORDER BY om.joined_at LIMIT 1',
            [orgId || null, playerId, tenantId]
        );

        if (orgResult.rows.length === 0) {
            return res.json({ entitlements: {}, plan: 'free' });
        }

        const org = orgResult.rows[0];
        const entitlements = await getAllEntitlements(org.id);
        const plan = await subscriptionSync.getEffectivePlan(org.id);

        res.json({ organisationId: org.id, plan, entitlements });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Upgrade Badge
// =========================================

/**
 * Check if the player should see an upgrade badge/prompt.
 * Returns upgrade signals based on usage thresholds.
 */
router.get('/upgrade-badge', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;

        const orgResult = await db.query(`
            SELECT o.id FROM organisations o
            JOIN organisation_members om ON o.id = om.organisation_id
            WHERE om.player_id = $1 AND om.tenant_id = $2
            ORDER BY om.joined_at LIMIT 1
        `, [playerId, tenantId]);

        if (orgResult.rows.length === 0) {
            // No org = free player, always show upgrade badge
            return res.json({
                showBadge: true,
                reason: 'no_organisation',
                message: 'Create an organisation to unlock team features',
                targetPlan: 'starter'
            });
        }

        const org = orgResult.rows[0];
        const plan = await subscriptionSync.getEffectivePlan(org.id);

        if (plan === 'enterprise') {
            return res.json({ showBadge: false });
        }

        // Check usage thresholds — show badge if usage > 80%
        const badges = [];
        const meters = await usageMeters.getAllStatuses(org.id, tenantId);

        for (const [key, meter] of Object.entries(meters)) {
            if (meter.limit !== null && meter.count > meter.limit * 0.8) {
                badges.push({
                    feature: key,
                    usage: meter.count,
                    limit: meter.limit,
                    percent: Math.round((meter.count / meter.limit) * 100)
                });
            }
        }

        // Check storage
        const totalStorage = await storageQuotas.getTotalUsage(org.id);
        const { getLimit } = require('../middleware/entitlements');
        const storageLimit = await getLimit(org.id, 'max_storage_mb');
        if (storageLimit !== null) {
            const usedMb = totalStorage / (1024 * 1024);
            if (usedMb > storageLimit * 0.8) {
                badges.push({
                    feature: 'storage',
                    usage: Math.round(usedMb),
                    limit: storageLimit,
                    percent: Math.round((usedMb / storageLimit) * 100)
                });
            }
        }

        const nextTier = plan === 'free' ? 'starter' : plan === 'starter' ? 'pro' : 'enterprise';

        res.json({
            showBadge: badges.length > 0 || plan === 'free',
            currentPlan: plan,
            targetPlan: nextTier,
            badges,
            message: badges.length > 0
                ? `You're using ${badges[0].percent}% of your ${badges[0].feature} limit`
                : plan === 'free' ? 'Upgrade to unlock more features' : null
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
