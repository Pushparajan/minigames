/**
 * Stripe Service Tests
 * =====================
 * Tests the Stripe SDK wrapper for customer creation,
 * subscription management, portal sessions, and webhooks.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockStripe, injectMocks, resetAll } = require('./helpers');

injectMocks();

describe('Stripe Service', () => {
    beforeEach(() => resetAll());

    describe('createCustomer', () => {
        it('should create a customer and return an ID', async () => {
            const customer = await mockStripe.createCustomer({
                email: 'teacher@school.edu',
                name: 'Ms. Science',
                metadata: { tenantId: 'stem_default' }
            });

            assert.equal(customer.id, 'cus_test_123');
            assert.equal(customer.email, 'teacher@school.edu');
        });

        it('should log the call for auditing', async () => {
            await mockStripe.createCustomer({ email: 'a@b.com', name: 'Test' });
            const log = mockStripe._getLog();
            assert.equal(log.length, 1);
            assert.equal(log[0].method, 'createCustomer');
        });
    });

    describe('createSubscription', () => {
        it('should create a trialing subscription', async () => {
            const sub = await mockStripe.createSubscription({
                customerId: 'cus_test_123',
                priceId: 'price_pro_monthly',
                trialDays: 14,
                metadata: { plan_tier: 'pro' }
            });

            assert.equal(sub.status, 'trialing');
            assert.ok(sub.trial_start);
            assert.ok(sub.trial_end);
            assert.ok(sub.trial_end > sub.trial_start);
            assert.equal(sub.customer, 'cus_test_123');
        });

        it('should create an active subscription without trial', async () => {
            const sub = await mockStripe.createSubscription({
                customerId: 'cus_test_123',
                priceId: 'price_starter',
                trialDays: 0,
                metadata: {}
            });

            assert.equal(sub.status, 'active');
            assert.equal(sub.trial_start, null);
            assert.equal(sub.trial_end, null);
        });

        it('should include payment intent client secret', async () => {
            const sub = await mockStripe.createSubscription({
                customerId: 'cus_123',
                priceId: 'price_pro',
                trialDays: 0,
                metadata: {}
            });

            assert.ok(sub.latest_invoice.payment_intent.client_secret);
        });
    });

    describe('cancelSubscription', () => {
        it('should cancel at period end by default', async () => {
            const result = await mockStripe.cancelSubscription('sub_123', {});
            assert.equal(result.status, 'active'); // still active until period end
            assert.equal(result.cancel_at_period_end, true);
        });

        it('should cancel immediately when requested', async () => {
            const result = await mockStripe.cancelSubscription('sub_123', { immediate: true });
            assert.equal(result.status, 'canceled');
            assert.equal(result.cancel_at_period_end, false);
        });
    });

    describe('resumeSubscription', () => {
        it('should resume a pending-cancellation subscription', async () => {
            const result = await mockStripe.resumeSubscription('sub_123');
            assert.equal(result.status, 'active');
            assert.equal(result.cancel_at_period_end, false);
            assert.equal(result.cancel_at, null);
        });
    });

    describe('getSubscription', () => {
        it('should retrieve subscription by ID', async () => {
            const sub = await mockStripe.getSubscription('sub_test_456');
            assert.equal(sub.id, 'sub_test_456');
            assert.equal(sub.status, 'active');
        });
    });

    describe('createBillingPortalSession', () => {
        it('should return a portal URL', async () => {
            const session = await mockStripe.createBillingPortalSession(
                'cus_123',
                'https://app.stemadventures.com/billing'
            );

            assert.ok(session.url.startsWith('https://'));
            assert.ok(session.url.includes('billing.stripe.com'));
        });
    });

    describe('constructWebhookEvent', () => {
        it('should parse a webhook payload', () => {
            const payload = JSON.stringify({
                id: 'evt_test_123',
                type: 'customer.subscription.created',
                data: { object: { id: 'sub_123', status: 'active' } }
            });

            const event = mockStripe.constructWebhookEvent(payload, 'sig_test');
            assert.equal(event.id, 'evt_test_123');
            assert.equal(event.type, 'customer.subscription.created');
        });
    });

    describe('createUsageRecord', () => {
        it('should report metered usage', async () => {
            const record = await mockStripe.createUsageRecord('si_123', 50);
            assert.equal(record.id, 'ur_test_123');

            const log = mockStripe._getLog();
            assert.equal(log[0].method, 'createUsageRecord');
            assert.equal(log[0].quantity, 50);
        });
    });
});
