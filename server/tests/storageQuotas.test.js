/**
 * Storage Quota Tests
 * ====================
 * Tests storage tracking, quota checking,
 * and usage breakdown.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockDb, mockCache, injectMocks, resetAll } = require('./helpers');

injectMocks();
const storageQuotas = require('../services/storageQuotas');

describe('Storage Quotas', () => {
    beforeEach(() => resetAll());

    describe('getTotalUsage', () => {
        it('should return total bytes used', async () => {
            mockDb._pushResult({ rows: [{ total: '52428800' }] }); // 50MB
            const total = await storageQuotas.getTotalUsage('org_1');
            assert.equal(total, 52428800);
        });

        it('should return 0 for empty org', async () => {
            mockDb._pushResult({ rows: [{ total: '0' }] });
            const total = await storageQuotas.getTotalUsage('org_empty');
            assert.equal(total, 0);
        });

        it('should cache result', async () => {
            mockDb._pushResult({ rows: [{ total: '1024' }] });
            await storageQuotas.getTotalUsage('org_cached');
            await storageQuotas.getTotalUsage('org_cached');
            assert.equal(mockDb._getLog().length, 1);
        });
    });

    describe('getUsageBreakdown', () => {
        it('should group by resource type', async () => {
            mockDb._pushResult({ rows: [
                { resource_type: 'avatar', file_count: '10', total_bytes: '1048576' },
                { resource_type: 'replay', file_count: '5', total_bytes: '5242880' },
                { resource_type: 'export', file_count: '2', total_bytes: '2097152' }
            ] });

            const breakdown = await storageQuotas.getUsageBreakdown('org_1');
            assert.equal(breakdown.avatar.fileCount, 10);
            assert.equal(breakdown.avatar.totalBytes, 1048576);
            assert.equal(breakdown.replay.fileCount, 5);
            assert.equal(breakdown.export.totalMb, 2); // 2097152 / 1024 / 1024 = 2
        });
    });

    describe('checkQuota', () => {
        it('should allow when under limit', async () => {
            mockDb._pushResult({ rows: [{ total: String(50 * 1024 * 1024) }] }); // 50MB used
            const result = await storageQuotas.checkQuota('org_1', 1024 * 1024, 100); // add 1MB, limit 100MB
            assert.equal(result.allowed, true);
            assert.equal(result.usedMb, 50);
            assert.equal(result.limitMb, 100);
            assert.equal(result.remainingMb, 50);
        });

        it('should deny when over limit', async () => {
            mockDb._pushResult({ rows: [{ total: String(99 * 1024 * 1024) }] }); // 99MB used
            const result = await storageQuotas.checkQuota('org_1', 2 * 1024 * 1024, 100); // add 2MB, limit 100MB
            assert.equal(result.allowed, false);
        });

        it('should always allow for unlimited (enterprise)', async () => {
            const result = await storageQuotas.checkQuota('org_ent', 999999999, null);
            assert.equal(result.allowed, true);
            assert.equal(result.limitMb, null);
        });

        it('should always allow for negative limit (enterprise alt)', async () => {
            const result = await storageQuotas.checkQuota('org_ent', 999999999, -1);
            assert.equal(result.allowed, true);
        });
    });

    describe('recordUsage', () => {
        it('should insert a storage record', async () => {
            mockDb._pushResult({ rows: [] });
            await storageQuotas.recordUsage('org_1', 'stem_default', 'avatar', 'file_123', 2048);

            const log = mockDb._getLog();
            assert.ok(log[0].text.includes('storage_usage'));
            assert.deepEqual(log[0].params, ['org_1', 'stem_default', 'avatar', 'file_123', 2048]);
        });
    });

    describe('removeUsage', () => {
        it('should delete a storage record', async () => {
            mockDb._pushResult({ rows: [] });
            await storageQuotas.removeUsage('org_1', 'avatar', 'file_123');

            const log = mockDb._getLog();
            assert.ok(log[0].text.includes('DELETE'));
        });
    });
});
