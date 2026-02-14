/**
 * Organisation Tests
 * ===================
 * Tests workspace creation, member management,
 * and entitlement-gated features.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockDb, mockCache, injectMocks, resetAll } = require('./helpers');

injectMocks();
const subscriptionSync = require('../services/subscriptionSync');

describe('Organisations', () => {
    beforeEach(() => resetAll());

    describe('Feature Gating', () => {
        it('free plan should not include organisations feature', () => {
            const free = subscriptionSync.PLAN_ENTITLEMENTS.free;
            assert.ok(!free.features.includes('organisations'));
        });

        it('starter plan should include organisations feature', () => {
            const starter = subscriptionSync.PLAN_ENTITLEMENTS.starter;
            assert.ok(starter.features.includes('organisations'));
        });

        it('free plan allows max 1 member', () => {
            assert.equal(subscriptionSync.PLAN_ENTITLEMENTS.free.max_members, 1);
        });

        it('starter plan allows 10 members', () => {
            assert.equal(subscriptionSync.PLAN_ENTITLEMENTS.starter.max_members, 10);
        });

        it('pro plan allows 50 members', () => {
            assert.equal(subscriptionSync.PLAN_ENTITLEMENTS.pro.max_members, 50);
        });

        it('enterprise plan allows unlimited members', () => {
            assert.equal(subscriptionSync.PLAN_ENTITLEMENTS.enterprise.max_members, -1);
        });
    });

    describe('Member Limit Enforcement', () => {
        it('should count current members correctly', async () => {
            const { getCurrentUsage } = require('../middleware/entitlements');
            mockDb._pushResult({ rows: [{ count: '8' }] });
            const count = await getCurrentUsage('org_1', 'max_members');
            assert.equal(count, 8);
        });
    });

    describe('Plan Provisioning', () => {
        it('provisionEntitlements should set correct features for starter', async () => {
            // Each feature + 3 limit features = ~12 DB calls
            for (let i = 0; i < 20; i++) {
                mockDb._pushResult({ rows: [] });
            }

            await subscriptionSync.provisionEntitlements('org_1', 'sub_1', 'stem_default', 'starter');

            const log = mockDb._getLog();
            // Verify entitlement inserts happened
            const entitlementInserts = log.filter(l => l.text.includes('entitlements'));
            assert.ok(entitlementInserts.length >= 9, `Expected >= 9 entitlement ops, got ${entitlementInserts.length}`);

            // Check that 'organisations' feature was provisioned
            const orgInsert = entitlementInserts.find(l =>
                l.params && l.params.includes('organisations')
            );
            assert.ok(orgInsert, 'organisations should be provisioned for starter');
            // The SQL uses `is_enabled = true` in the VALUES for enabled features
            assert.ok(orgInsert.text.includes('is_enabled'), 'Query should reference is_enabled');
        });

        it('revokeEntitlements should downgrade to free', async () => {
            for (let i = 0; i < 20; i++) {
                mockDb._pushResult({ rows: [] });
            }

            await subscriptionSync.revokeEntitlements('org_1', 'stem_default');

            const log = mockDb._getLog();
            // All features should have entitlement writes
            const entitlementInserts = log.filter(l => l.text.includes('entitlements'));
            assert.ok(entitlementInserts.length >= 9, `Expected >= 9 entitlement ops for revocation, got ${entitlementInserts.length}`);

            // Free plan has 0 premium features, so all 9 should be set to disabled
            // The 'organisations' feature should be in the set (disabled for free)
            const orgEntry = entitlementInserts.find(l => l.params && l.params.includes('organisations'));
            assert.ok(orgEntry, 'organisations feature should be in revocation set');
        });
    });

    describe('Storage Limits per Plan', () => {
        it('free plan should have 100MB storage', () => {
            assert.equal(subscriptionSync.PLAN_ENTITLEMENTS.free.max_storage_mb, 100);
        });

        it('starter plan should have 1GB storage', () => {
            assert.equal(subscriptionSync.PLAN_ENTITLEMENTS.starter.max_storage_mb, 1024);
        });

        it('pro plan should have 10GB storage', () => {
            assert.equal(subscriptionSync.PLAN_ENTITLEMENTS.pro.max_storage_mb, 10240);
        });

        it('enterprise should have unlimited storage', () => {
            assert.equal(subscriptionSync.PLAN_ENTITLEMENTS.enterprise.max_storage_mb, -1);
        });
    });

    describe('Game Limits per Plan', () => {
        it('free plan allows 5 games', () => {
            assert.equal(subscriptionSync.PLAN_ENTITLEMENTS.free.max_games, 5);
        });

        it('starter plan allows 15 games', () => {
            assert.equal(subscriptionSync.PLAN_ENTITLEMENTS.starter.max_games, 15);
        });

        it('pro and enterprise allow all 25 games', () => {
            assert.equal(subscriptionSync.PLAN_ENTITLEMENTS.pro.max_games, 25);
            assert.equal(subscriptionSync.PLAN_ENTITLEMENTS.enterprise.max_games, 25);
        });
    });
});
