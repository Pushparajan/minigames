/**
 * Entitlement Enforcement Tests
 * ===============================
 * Tests middleware for feature gating, limit enforcement,
 * and usage quota checking.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockDb, mockCache, injectMocks, resetAll } = require('./helpers');

injectMocks();
const { checkEntitlement, getLimit, getCurrentUsage, getAllEntitlements } = require('../middleware/entitlements');

describe('Entitlement Enforcement', () => {
    beforeEach(() => resetAll());

    describe('checkEntitlement', () => {
        it('should return true for an enabled feature', async () => {
            mockDb._pushResult({ rows: [
                { feature_key: 'organisations', is_enabled: true, limit_value: null },
                { feature_key: 'multiplayer', is_enabled: true, limit_value: null }
            ] });

            const result = await checkEntitlement('org_1', 'organisations');
            assert.equal(result, true);
        });

        it('should return false for a disabled feature', async () => {
            mockDb._pushResult({ rows: [
                { feature_key: 'organisations', is_enabled: false, limit_value: null }
            ] });

            const result = await checkEntitlement('org_1', 'organisations');
            assert.equal(result, false);
        });

        it('should return false for a non-existent feature', async () => {
            mockDb._pushResult({ rows: [] });
            const result = await checkEntitlement('org_1', 'nonexistent_feature');
            assert.equal(result, false);
        });

        it('should use cache on second call', async () => {
            mockDb._pushResult({ rows: [
                { feature_key: 'multiplayer', is_enabled: true, limit_value: null }
            ] });

            await checkEntitlement('org_cached', 'multiplayer');

            // Second call should not hit DB
            const result = await checkEntitlement('org_cached', 'multiplayer');
            assert.equal(result, true);

            // Only one DB query
            const logs = mockDb._getLog();
            assert.equal(logs.length, 1);
        });
    });

    describe('getLimit', () => {
        it('should return numeric limit value', async () => {
            mockDb._pushResult({ rows: [
                { feature_key: 'max_members', is_enabled: true, limit_value: 50 }
            ] });

            const limit = await getLimit('org_1', 'max_members');
            assert.equal(limit, 50);
        });

        it('should return null for unlimited (enterprise)', async () => {
            mockDb._pushResult({ rows: [
                { feature_key: 'max_members', is_enabled: true, limit_value: null }
            ] });

            const limit = await getLimit('org_1', 'max_members');
            assert.equal(limit, null);
        });
    });

    describe('getCurrentUsage', () => {
        it('should count members for max_members', async () => {
            mockDb._pushResult({ rows: [{ count: '7' }] });
            const usage = await getCurrentUsage('org_1', 'max_members');
            assert.equal(usage, 7);
        });

        it('should calculate storage in MB for max_storage_mb', async () => {
            mockDb._pushResult({ rows: [{ total: String(10 * 1024 * 1024) }] }); // 10MB
            const usage = await getCurrentUsage('org_1', 'max_storage_mb');
            assert.equal(usage, 10);
        });

        it('should return 0 for unknown feature', async () => {
            const usage = await getCurrentUsage('org_1', 'unknown_feature');
            assert.equal(usage, 0);
        });
    });

    describe('getAllEntitlements', () => {
        it('should return all entitlements as a map', async () => {
            mockDb._pushResult({ rows: [
                { feature_key: 'organisations', is_enabled: true, limit_value: null, usage_count: 0 },
                { feature_key: 'max_members', is_enabled: true, limit_value: 10, usage_count: 3 },
                { feature_key: 'analytics_dashboard', is_enabled: false, limit_value: null, usage_count: 0 }
            ] });

            const result = await getAllEntitlements('org_1');

            assert.equal(result.organisations.enabled, true);
            assert.equal(result.max_members.limit, 10);
            assert.equal(result.analytics_dashboard.enabled, false);
        });
    });

    describe('requireEntitlement middleware', () => {
        it('should return 401 for unauthenticated request', async () => {
            const { requireEntitlement } = require('../middleware/entitlements');
            const middleware = requireEntitlement('organisations');

            const req = { player: null, params: {}, body: {}, query: {} };
            let statusCode, responseBody;
            const res = {
                status: (code) => { statusCode = code; return res; },
                json: (body) => { responseBody = body; }
            };
            const next = () => {};

            await middleware(req, res, next);
            assert.equal(statusCode, 401);
        });

        it('should return 403 when no organisation found', async () => {
            const { requireEntitlement } = require('../middleware/entitlements');
            const middleware = requireEntitlement('organisations');

            // Mock: no org memberships
            mockDb._pushResult({ rows: [] });

            const req = { player: { id: 'p1', tenantId: 'stem_default' }, params: {}, body: {}, query: {} };
            let statusCode, responseBody;
            const res = {
                status: (code) => { statusCode = code; return res; },
                json: (body) => { responseBody = body; }
            };
            const next = () => {};

            await middleware(req, res, next);
            assert.equal(statusCode, 403);
            assert.equal(responseBody.code, 'NO_ORGANISATION');
        });
    });
});
