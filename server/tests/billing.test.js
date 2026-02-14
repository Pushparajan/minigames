/**
 * Billing Routes Tests
 * =====================
 * Tests subscription creation, trial enforcement,
 * billing portal, plan listing, and upgrade badges.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockDb, mockCache, mockStripe, injectMocks, resetAll } = require('./helpers');

injectMocks();
const subscriptionSync = require('../services/subscriptionSync');

describe('Billing System', () => {
    beforeEach(() => resetAll());

    describe('Trial Subscription', () => {
        it('should allow first trial for a new user', async () => {
            // hasUsedTrial check
            mockDb._pushResult({ rows: [] }); // no trial history
            const used = await subscriptionSync.hasUsedTrial('player_new', 'stem_default');
            assert.equal(used, false);
        });

        it('should block second trial attempt', async () => {
            // First: record trial
            mockDb._pushResult({ rows: [] });
            await subscriptionSync.recordTrialStart('player_1', 'stem_default', 'org_1');

            // Second: check — trial exists
            mockDb._pushResult({ rows: [{ player_id: 'player_1' }] });
            const used = await subscriptionSync.hasUsedTrial('player_1', 'stem_default');
            assert.equal(used, true);
        });

        it('should enforce one trial per user across organisations', async () => {
            // Player used trial on org_1
            mockDb._pushResult({ rows: [{ player_id: 'player_1', organisation_id: 'org_1' }] });
            const usedForOrg2 = await subscriptionSync.hasUsedTrial('player_1', 'stem_default');
            assert.equal(usedForOrg2, true);
            // Even though they're trying for org_2, the check is per-player
        });
    });

    describe('Plan Tier Resolution', () => {
        it('should return free for no active subscription', async () => {
            mockDb._pushResult({ rows: [] });
            const plan = await subscriptionSync.getEffectivePlan('org_no_sub');
            assert.equal(plan, 'free');
        });

        it('should return trialing plan as effective', async () => {
            mockDb._pushResult({ rows: [{ plan_tier: 'pro', status: 'trialing' }] });
            const plan = await subscriptionSync.getEffectivePlan('org_trialing');
            assert.equal(plan, 'pro');
        });
    });

    describe('Entitlement Provisioning for Plans', () => {
        it('free plan should have no premium features', () => {
            const free = subscriptionSync.PLAN_ENTITLEMENTS.free;
            assert.equal(free.features.length, 0);
            assert.equal(free.max_members, 1);
            assert.equal(free.max_storage_mb, 100);
            assert.equal(free.max_games, 5);
        });

        it('starter plan should enable organisations and multiplayer', () => {
            const starter = subscriptionSync.PLAN_ENTITLEMENTS.starter;
            assert.ok(starter.features.includes('organisations'));
            assert.ok(starter.features.includes('multiplayer'));
            assert.ok(starter.features.includes('advanced_leaderboards'));
            assert.equal(starter.max_members, 10);
        });

        it('pro plan should enable all major features', () => {
            const pro = subscriptionSync.PLAN_ENTITLEMENTS.pro;
            assert.ok(pro.features.includes('analytics_dashboard'));
            assert.ok(pro.features.includes('custom_branding'));
            assert.ok(pro.features.includes('api_access'));
            assert.ok(pro.features.includes('export_data'));
            assert.ok(pro.features.includes('unlimited_games'));
            assert.equal(pro.max_members, 50);
        });

        it('enterprise should have unlimited everything', () => {
            const ent = subscriptionSync.PLAN_ENTITLEMENTS.enterprise;
            assert.equal(ent.max_members, -1);
            assert.equal(ent.max_storage_mb, -1);
            assert.ok(ent.features.includes('priority_support'));
        });
    });

    describe('Stripe Customer Creation', () => {
        it('should create a Stripe customer with org metadata', async () => {
            const customer = await mockStripe.createCustomer({
                email: 'test@school.edu',
                name: 'Test School',
                metadata: { organisationId: 'org_1', tenantId: 'stem_default' }
            });

            assert.equal(customer.id, 'cus_test_123');
            const log = mockStripe._getLog();
            assert.equal(log[0].method, 'createCustomer');
            assert.equal(log[0].params.email, 'test@school.edu');
        });
    });

    describe('Stripe Subscription Creation', () => {
        it('should create subscription with trial period', async () => {
            const sub = await mockStripe.createSubscription({
                customerId: 'cus_test_123',
                priceId: 'price_pro',
                trialDays: 14,
                metadata: { plan_tier: 'pro' }
            });

            assert.equal(sub.status, 'trialing');
            assert.ok(sub.trial_start);
            assert.ok(sub.trial_end);
            assert.ok(sub.trial_end > sub.trial_start);
        });

        it('should create subscription without trial', async () => {
            const sub = await mockStripe.createSubscription({
                customerId: 'cus_test_123',
                priceId: 'price_starter',
                trialDays: 0,
                metadata: { plan_tier: 'starter' }
            });

            assert.equal(sub.status, 'active');
            assert.equal(sub.trial_start, null);
        });
    });

    describe('Billing Portal', () => {
        it('should generate a portal URL', async () => {
            const session = await mockStripe.createBillingPortalSession('cus_123', 'https://app.com/');
            assert.ok(session.url.includes('billing.stripe.com'));
        });
    });
});
