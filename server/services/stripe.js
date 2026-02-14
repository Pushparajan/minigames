/**
 * Stripe Service
 * ===============
 * Core Stripe SDK wrapper. Initializes the Stripe client
 * and provides helpers for common operations.
 */

const config = require('../config');

let stripe = null;

function init() {
    const Stripe = require('stripe');
    stripe = Stripe(config.stripe.secretKey, {
        apiVersion: '2024-12-18.acacia',
        maxNetworkRetries: 3
    });
    return stripe;
}

function getClient() {
    if (!stripe) init();
    return stripe;
}

/**
 * Create a Stripe customer for an organisation.
 */
async function createCustomer({ email, name, metadata = {} }) {
    return getClient().customers.create({
        email,
        name,
        metadata
    });
}

/**
 * Create a subscription (with optional trial).
 */
async function createSubscription({ customerId, priceId, trialDays, metadata = {} }) {
    const params = {
        customer: customerId,
        items: [{ price: priceId }],
        metadata,
        payment_behavior: 'default_incomplete',
        expand: ['latest_invoice.payment_intent']
    };

    if (trialDays && trialDays > 0) {
        params.trial_period_days = trialDays;
        params.payment_behavior = 'default_incomplete';
    }

    return getClient().subscriptions.create(params);
}

/**
 * Cancel a subscription (at period end by default).
 */
async function cancelSubscription(subscriptionId, { immediate = false } = {}) {
    if (immediate) {
        return getClient().subscriptions.cancel(subscriptionId);
    }
    return getClient().subscriptions.update(subscriptionId, {
        cancel_at_period_end: true
    });
}

/**
 * Resume a subscription that was scheduled for cancellation.
 */
async function resumeSubscription(subscriptionId) {
    return getClient().subscriptions.update(subscriptionId, {
        cancel_at_period_end: false
    });
}

/**
 * Retrieve a subscription from Stripe.
 */
async function getSubscription(subscriptionId) {
    return getClient().subscriptions.retrieve(subscriptionId);
}

/**
 * Create a billing portal session for self-service management.
 */
async function createBillingPortalSession(customerId, returnUrl) {
    return getClient().billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl
    });
}

/**
 * Create a checkout session for initial subscription.
 */
async function createCheckoutSession({ customerId, priceId, successUrl, cancelUrl, trialDays, metadata = {} }) {
    const params = {
        customer: customerId,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata
    };

    if (trialDays && trialDays > 0) {
        params.subscription_data = {
            trial_period_days: trialDays
        };
    }

    return getClient().checkout.sessions.create(params);
}

/**
 * Construct and verify a webhook event from the raw body.
 */
function constructWebhookEvent(rawBody, signature) {
    return getClient().webhooks.constructEvent(
        rawBody,
        signature,
        config.stripe.webhookSecret
    );
}

/**
 * Report usage to a metered subscription item.
 */
async function createUsageRecord(subscriptionItemId, quantity, timestamp) {
    return getClient().subscriptionItems.createUsageRecord(subscriptionItemId, {
        quantity,
        timestamp: timestamp || Math.floor(Date.now() / 1000),
        action: 'increment'
    });
}

module.exports = {
    init,
    getClient,
    createCustomer,
    createSubscription,
    cancelSubscription,
    resumeSubscription,
    getSubscription,
    createBillingPortalSession,
    createCheckoutSession,
    constructWebhookEvent,
    createUsageRecord
};
