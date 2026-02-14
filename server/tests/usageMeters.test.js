/**
 * Usage Meter Tests
 * ==================
 * Tests metered usage tracking, quota enforcement,
 * and period management.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockDb, mockCache, injectMocks, resetAll } = require('./helpers');

injectMocks();
const usageMeters = require('../services/usageMeters');

describe('Usage Meters', () => {
    beforeEach(() => resetAll());

    describe('increment', () => {
        it('should increment and return updated count', async () => {
            mockDb._pushResult({ rows: [{
                count: '5',
                limit_value: 1000,
                period_end: new Date(2026, 2, 1)
            }] });

            const result = await usageMeters.increment('org_1', 'stem_default', 'api_calls', 1);
            assert.equal(result.count, 5);
            assert.equal(result.limit, 1000);
            assert.equal(result.remaining, 995);
        });

        it('should handle unlimited meters (null limit)', async () => {
            mockDb._pushResult({ rows: [{
                count: '500',
                limit_value: null,
                period_end: new Date(2026, 2, 1)
            }] });

            const result = await usageMeters.increment('org_ent', 'stem_default', 'api_calls', 1);
            assert.equal(result.count, 500);
            assert.equal(result.limit, null);
            assert.equal(result.remaining, null);
        });
    });

    describe('getStatus', () => {
        it('should return zero count when no meter exists', async () => {
            mockDb._pushResult({ rows: [] });
            const status = await usageMeters.getStatus('org_new', 'stem_default', 'api_calls');
            assert.equal(status.count, 0);
            assert.equal(status.limit, null);
        });

        it('should return current meter status', async () => {
            mockDb._pushResult({ rows: [{
                count: '42',
                limit_value: 100,
                period_end: new Date(2026, 2, 1)
            }] });

            const status = await usageMeters.getStatus('org_1', 'stem_default', 'game_sessions');
            assert.equal(status.count, 42);
            assert.equal(status.limit, 100);
            assert.equal(status.remaining, 58);
        });

        it('should cache status on second call', async () => {
            mockDb._pushResult({ rows: [{
                count: '10',
                limit_value: 50,
                period_end: new Date(2026, 2, 1)
            }] });

            await usageMeters.getStatus('org_cache_test', 'stem_default', 'data_exports');
            const status = await usageMeters.getStatus('org_cache_test', 'stem_default', 'data_exports');

            assert.equal(status.count, 10);
            // Only one DB query
            assert.equal(mockDb._getLog().length, 1);
        });
    });

    describe('hasQuota', () => {
        it('should return true when under limit', async () => {
            mockDb._pushResult({ rows: [{
                count: '5',
                limit_value: 50,
                period_end: new Date(2026, 2, 1)
            }] });

            const has = await usageMeters.hasQuota('org_1', 'stem_default', 'data_exports', 1);
            assert.equal(has, true);
        });

        it('should return false when at limit', async () => {
            mockDb._pushResult({ rows: [{
                count: '50',
                limit_value: 50,
                period_end: new Date(2026, 2, 1)
            }] });

            const has = await usageMeters.hasQuota('org_1', 'stem_default', 'data_exports', 1);
            assert.equal(has, false);
        });

        it('should always return true for unlimited', async () => {
            mockDb._pushResult({ rows: [{
                count: '999999',
                limit_value: null,
                period_end: new Date(2026, 2, 1)
            }] });

            const has = await usageMeters.hasQuota('org_ent', 'stem_default', 'api_calls', 1000);
            assert.equal(has, true);
        });
    });

    describe('getAllStatuses', () => {
        it('should return statuses for all meter keys', async () => {
            mockDb._pushResult({ rows: [{ count: '100', limit_value: 1000, period_end: new Date() }] });
            mockDb._pushResult({ rows: [{ count: '50', limit_value: 500, period_end: new Date() }] });
            mockDb._pushResult({ rows: [{ count: '2', limit_value: 5, period_end: new Date() }] });

            const all = await usageMeters.getAllStatuses('org_1', 'stem_default');
            assert.ok(all.api_calls);
            assert.ok(all.game_sessions);
            assert.ok(all.data_exports);
        });
    });

    describe('METER_LIMITS', () => {
        it('should define limits for all tiers', () => {
            assert.equal(usageMeters.METER_LIMITS.free.api_calls, 1000);
            assert.equal(usageMeters.METER_LIMITS.starter.api_calls, 50000);
            assert.equal(usageMeters.METER_LIMITS.pro.api_calls, 500000);
            assert.equal(usageMeters.METER_LIMITS.enterprise.api_calls, null);
        });
    });
});
