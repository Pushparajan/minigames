/**
 * Storage Quota Service
 * ======================
 * Tracks and enforces per-organisation storage limits.
 * Storage types: avatars, replays, exports, attachments.
 */

const db = require('../models/db');
const cache = require('./cache');

const STORAGE_CACHE_TTL = 300; // 5 minutes

/**
 * Record storage usage for a resource.
 *
 * @param {string} organisationId
 * @param {string} tenantId
 * @param {string} resourceType - 'avatar', 'replay', 'export', 'attachment'
 * @param {string} resourceId
 * @param {number} sizeBytes
 */
async function recordUsage(organisationId, tenantId, resourceType, resourceId, sizeBytes) {
    await db.query(`
        INSERT INTO storage_usage (organisation_id, tenant_id, resource_type, resource_id, size_bytes)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (organisation_id, resource_type, resource_id) DO UPDATE SET
            size_bytes = EXCLUDED.size_bytes
    `, [organisationId, tenantId, resourceType, resourceId, sizeBytes]);

    await cache.del(`storage:${organisationId}`);
}

/**
 * Remove a storage record (e.g., when deleting a resource).
 */
async function removeUsage(organisationId, resourceType, resourceId) {
    await db.query(
        'DELETE FROM storage_usage WHERE organisation_id = $1 AND resource_type = $2 AND resource_id = $3',
        [organisationId, resourceType, resourceId]
    );
    await cache.del(`storage:${organisationId}`);
}

/**
 * Get total storage usage in bytes.
 */
async function getTotalUsage(organisationId) {
    const cacheKey = `storage:${organisationId}`;
    const cached = await cache.get(cacheKey);
    if (cached !== null && cached !== undefined) return cached;

    const result = await db.query(
        'SELECT COALESCE(SUM(size_bytes), 0) as total FROM storage_usage WHERE organisation_id = $1',
        [organisationId]
    );

    const total = parseInt(result.rows[0].total, 10);
    await cache.set(cacheKey, total, STORAGE_CACHE_TTL);
    return total;
}

/**
 * Get usage breakdown by resource type.
 */
async function getUsageBreakdown(organisationId) {
    const result = await db.query(`
        SELECT resource_type, COUNT(*) as file_count, SUM(size_bytes) as total_bytes
        FROM storage_usage WHERE organisation_id = $1
        GROUP BY resource_type
    `, [organisationId]);

    const breakdown = {};
    for (const row of result.rows) {
        breakdown[row.resource_type] = {
            fileCount: parseInt(row.file_count, 10),
            totalBytes: parseInt(row.total_bytes, 10),
            totalMb: Math.round(parseInt(row.total_bytes, 10) / (1024 * 1024) * 100) / 100
        };
    }
    return breakdown;
}

/**
 * Check if an organisation has enough storage quota.
 *
 * @param {string} organisationId
 * @param {number} additionalBytes - How many bytes we want to add
 * @param {number} limitMb - Storage limit in MB (from entitlements)
 * @returns {{ allowed: boolean, usedMb: number, limitMb: number, remainingMb: number }}
 */
async function checkQuota(organisationId, additionalBytes, limitMb) {
    if (limitMb === null || limitMb < 0) {
        // Unlimited
        return { allowed: true, usedMb: 0, limitMb: null, remainingMb: null };
    }

    const totalBytes = await getTotalUsage(organisationId);
    const usedMb = totalBytes / (1024 * 1024);
    const remainingMb = limitMb - usedMb;
    const additionalMb = additionalBytes / (1024 * 1024);

    return {
        allowed: usedMb + additionalMb <= limitMb,
        usedMb: Math.round(usedMb * 100) / 100,
        limitMb,
        remainingMb: Math.round(Math.max(0, remainingMb) * 100) / 100
    };
}

module.exports = {
    recordUsage,
    removeUsage,
    getTotalUsage,
    getUsageBreakdown,
    checkQuota
};
