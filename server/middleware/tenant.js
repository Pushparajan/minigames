/**
 * Multi-Tenant Resolution Middleware
 * ====================================
 * Resolves tenant from API key header for SaaS multi-tenancy.
 * Supports data isolation per tenant (school, organization).
 */

const config = require('../config');

function tenantResolver(req, res, next) {
    const apiKey = req.headers[config.tenant.apiKeyHeader];

    if (apiKey) {
        // In production, validate against tenant registry DB/cache
        req.tenantId = _resolveTenantFromKey(apiKey);
    } else {
        req.tenantId = config.tenant.defaultTenantId;
    }

    next();
}

/**
 * Resolve tenant ID from API key.
 * In production: look up in Redis cache → DB.
 * Here: simple extraction for dev.
 */
function _resolveTenantFromKey(apiKey) {
    // API key format: "tenant_<id>_<secret>"
    const parts = apiKey.split('_');
    if (parts.length >= 2 && parts[0] === 'tenant') {
        return parts[1];
    }
    return config.tenant.defaultTenantId;
}

module.exports = { tenantResolver };
