/**
 * SubscriptionSyncService Tests
 * ===============================
 * Tests Stripe→DB synchronization, entitlement provisioning,
 * trial tracking, and plan resolution.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockDb, mockCache, injectMocks, resetAll } = require('./helpers');

// Inject mocks before loading the module
injectMocks();
const subscriptionSync = require('../services/subscriptionSync');

describe('SubscriptionSyncService', () => {
    beforeEach(() => resetAll());

    describe('syncFromStripe', () => {
        it('should upsert subscription and provision entitlements for active sub', async () => {
            // Mock: find org by stripe customer ID
            mockDb._pushResult({ rows: [{ id: 'org_1' }] });
            // Mock: upsert subscription
            mockDb._pushResult({ rows: [{
                id: 'sub_local_1',
                organisation_id: 'org_1',
                status: 'active',
                plan_tier: 'pro',
                trial_end: null
            }] });
            // Mock: entitlement upserts (multiple calls)
            for (let i = 0; i < 20; i++) {
                mockDb._pushResult({ rows: [] });
            }

            const stripeSub = {
                id: 'sub_stripe_1',
                customer: 'cus_123',
                status: 'active',
                items: { data: [{ price: { id: 'price_pro' } }] },
                current_period_start: Math.floor(Date.now() / 1000),
                current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
                metadata: { plan_tier: 'pro' }
            };

            const result = await subscriptionSync.syncFromStripe(stripeSub, 'stem_default');
            assert.equal(result.status, 'active');
            assert.equal(result.plan_tier, 'pro');

            // Verify org lookup was called
            const logs = mockDb._getLog();
            assert.ok(logs[0].text.includes('organisations'));
        });

        it('should throw if no organisation found for customer', async () => {
            mockDb._pushResult({ rows: [] }); // No org found

            const stripeSub = {
                id: 'sub_test',
                customer: 'cus_nonexistent',
                status: 'active',
                items: { data: [] },
                metadata: {}
            };

            await assert.rejects(
                () => subscriptionSync.syncFromStripe(stripeSub, 'stem_default'),
                { message: /No organisation found/ }
            );
        });

        it('should revoke entitlements for canceled subscription', async () => {
            mockDb._pushResult({ rows: [{ id: 'org_1' }] });
            mockDb._pushResult({ rows: [{
                id: 'sub_local_1',
                organisation_id: 'org_1',
                status: 'canceled',
                plan_tier: 'free'
            }] });
            // Revocation calls (free tier entitlements)
            for (let i = 0; i < 20; i++) {
                mockDb._pushResult({ rows: [] });
            }

            const stripeSub = {
                id: 'sub_canceled',
                customer: 'cus_123',
                status: 'canceled',
                items: { data: [] },
                canceled_at: Math.floor(Date.now() / 1000),
                metadata: {}
            };

            const result = await subscriptionSync.syncFromStripe(stripeSub, 'stem_default');
            assert.equal(result.status, 'canceled');
        });
    });

    describe('hasUsedTrial', () => {
        it('should return false when no trial record exists', async () => {
            mockDb._pushResult({ rows: [] });
            const result = await subscriptionSync.hasUsedTrial('player_1', 'stem_default');
            assert.equal(result, false);
        });

        it('should return true when trial record exists', async () => {
            mockDb._pushResult({ rows: [{ player_id: 'player_1' }] });
            const result = await subscriptionSync.hasUsedTrial('player_1', 'stem_default');
            assert.equal(result, true);
        });
    });

    describe('recordTrialStart', () => {
        it('should insert trial history', async () => {
            mockDb._pushResult({ rows: [] });
            await subscriptionSync.recordTrialStart('player_1', 'stem_default', 'org_1');

            const logs = mockDb._getLog();
            assert.ok(logs[0].text.includes('trial_history'));
            assert.deepEqual(logs[0].params, ['player_1', 'stem_default', 'org_1']);
        });
    });

    describe('getEffectivePlan', () => {
        it('should return free when no active subscription', async () => {
            mockDb._pushResult({ rows: [] });
            const plan = await subscriptionSync.getEffectivePlan('org_1');
            assert.equal(plan, 'free');
        });

        it('should return the active plan tier', async () => {
            mockDb._pushResult({ rows: [{ plan_tier: 'pro', status: 'active' }] });
            const plan = await subscriptionSync.getEffectivePlan('org_1');
            assert.equal(plan, 'pro');
        });
    });

    describe('PLAN_ENTITLEMENTS', () => {
        it('should define all 4 plan tiers', () => {
            assert.ok(subscriptionSync.PLAN_ENTITLEMENTS.free);
            assert.ok(subscriptionSync.PLAN_ENTITLEMENTS.starter);
            assert.ok(subscriptionSync.PLAN_ENTITLEMENTS.pro);
            assert.ok(subscriptionSync.PLAN_ENTITLEMENTS.enterprise);
        });

        it('should have correct feature counts per tier', () => {
            assert.equal(subscriptionSync.PLAN_ENTITLEMENTS.free.features.length, 0);
            assert.equal(subscriptionSync.PLAN_ENTITLEMENTS.starter.features.length, 3);
            assert.ok(subscriptionSync.PLAN_ENTITLEMENTS.pro.features.length >= 7);
            assert.ok(subscriptionSync.PLAN_ENTITLEMENTS.enterprise.features.length >= 8);
        });

        it('enterprise should have unlimited members', () => {
            assert.equal(subscriptionSync.PLAN_ENTITLEMENTS.enterprise.max_members, -1);
        });
    });
});
