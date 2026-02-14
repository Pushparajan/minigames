/**
 * Stripe Webhook Event Handlers
 * ===============================
 * Processes Stripe webhook events for subscription lifecycle management.
 *
 * Events handled:
 * - customer.subscription.created
 * - customer.subscription.updated
 * - customer.subscription.deleted
 * - customer.subscription.trial_will_end
 * - invoice.payment_succeeded
 * - invoice.payment_failed
 * - checkout.session.completed
 *
 * All events are idempotent (deduped by Stripe event ID).
 */

const express = require('express');
const db = require('../models/db');
const stripeService = require('../services/stripe');
const subscriptionSync = require('../services/subscriptionSync');
const config = require('../config');

const router = express.Router();

/**
 * Stripe webhook endpoint.
 * IMPORTANT: Must use raw body parser for signature verification.
 */
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['stripe-signature'];

    let event;
    try {
        event = stripeService.constructWebhookEvent(req.body, signature);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).json({ error: 'Invalid signature' });
    }

    // Idempotency check: skip if already processed
    const tenantId = req.tenantId || config.tenant.defaultTenantId;
    const alreadyProcessed = await _checkIdempotency(event.id, tenantId);
    if (alreadyProcessed) {
        return res.json({ received: true, status: 'already_processed' });
    }

    try {
        await _handleEvent(event, tenantId);

        // Record successful processing
        await _recordEvent(event.id, tenantId, event.type, event.data.object, 'processed');

        res.json({ received: true });
    } catch (err) {
        console.error(`Webhook handler error for ${event.type}:`, err);

        // Record failure but still return 200 to prevent Stripe retries for known errors
        await _recordEvent(event.id, tenantId, event.type, event.data.object, 'failed');

        res.status(200).json({ received: true, error: err.message });
    }
});

// =========================================
// Event Routing
// =========================================

async function _handleEvent(event, tenantId) {
    const obj = event.data.object;

    switch (event.type) {
        case 'customer.subscription.created':
            return _onSubscriptionCreated(obj, tenantId);

        case 'customer.subscription.updated':
            return _onSubscriptionUpdated(obj, tenantId);

        case 'customer.subscription.deleted':
            return _onSubscriptionDeleted(obj, tenantId);

        case 'customer.subscription.trial_will_end':
            return _onTrialWillEnd(obj, tenantId);

        case 'invoice.payment_succeeded':
            return _onPaymentSucceeded(obj, tenantId);

        case 'invoice.payment_failed':
            return _onPaymentFailed(obj, tenantId);

        case 'checkout.session.completed':
            return _onCheckoutCompleted(obj, tenantId);

        default:
            console.log(`Unhandled webhook event: ${event.type}`);
    }
}

// =========================================
// Subscription Events
// =========================================

async function _onSubscriptionCreated(subscription, tenantId) {
    console.log(`Subscription created: ${subscription.id} [${subscription.status}]`);
    await subscriptionSync.syncFromStripe(subscription, tenantId);
}

async function _onSubscriptionUpdated(subscription, tenantId) {
    console.log(`Subscription updated: ${subscription.id} [${subscription.status}]`);
    const localSub = await subscriptionSync.syncFromStripe(subscription, tenantId);

    // If subscription became active from trialing, mark trial as converted
    if (subscription.status === 'active' && localSub.trial_end) {
        const orgResult = await db.query(
            'SELECT owner_id FROM organisations WHERE id = $1',
            [localSub.organisation_id]
        );
        if (orgResult.rows.length > 0) {
            await subscriptionSync.markTrialConverted(orgResult.rows[0].owner_id, tenantId);
        }
    }
}

async function _onSubscriptionDeleted(subscription, tenantId) {
    console.log(`Subscription deleted: ${subscription.id}`);
    await subscriptionSync.syncFromStripe(subscription, tenantId);
    // Entitlements are automatically revoked in syncFromStripe when status = 'canceled'
}

async function _onTrialWillEnd(subscription, tenantId) {
    console.log(`Trial ending soon: ${subscription.id} (ends ${new Date(subscription.trial_end * 1000).toISOString()})`);
    // Could trigger email notification here
    // For now, just sync the latest state
    await subscriptionSync.syncFromStripe(subscription, tenantId);
}

// =========================================
// Invoice Events
// =========================================

async function _onPaymentSucceeded(invoice, tenantId) {
    console.log(`Payment succeeded: ${invoice.id} for customer ${invoice.customer}`);

    if (invoice.subscription) {
        // Fetch full subscription and sync
        const subscription = await stripeService.getSubscription(invoice.subscription);
        await subscriptionSync.syncFromStripe(subscription, tenantId);
    }
}

async function _onPaymentFailed(invoice, tenantId) {
    console.log(`Payment failed: ${invoice.id} for customer ${invoice.customer}`);

    if (invoice.subscription) {
        // Sync — status will likely be 'past_due'
        const subscription = await stripeService.getSubscription(invoice.subscription);
        await subscriptionSync.syncFromStripe(subscription, tenantId);
    }
}

// =========================================
// Checkout Events
// =========================================

async function _onCheckoutCompleted(session, tenantId) {
    console.log(`Checkout completed: ${session.id}`);

    if (session.subscription) {
        const subscription = await stripeService.getSubscription(session.subscription);
        await subscriptionSync.syncFromStripe(subscription, tenantId);
    }
}

// =========================================
// Idempotency
// =========================================

async function _checkIdempotency(eventId, tenantId) {
    const result = await db.query(
        'SELECT 1 FROM stripe_events WHERE id = $1 AND tenant_id = $2',
        [eventId, tenantId]
    );
    return result.rows.length > 0;
}

async function _recordEvent(eventId, tenantId, eventType, payload, status) {
    await db.query(`
        INSERT INTO stripe_events (id, tenant_id, event_type, payload, status)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status
    `, [eventId, tenantId, eventType, JSON.stringify(payload), status]);
}

module.exports = router;
