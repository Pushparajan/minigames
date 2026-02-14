/**
 * Test Helpers
 * =============
 * Shared mocks and utilities for the test suite.
 * Mocks DB, cache, and Stripe to avoid external dependencies.
 */

// =========================================
// DB Mock
// =========================================

const _queryResults = [];
let _queryLog = [];

const mockDb = {
    init: async () => {},
    healthCheck: async () => true,
    query: async (text, params) => {
        _queryLog.push({ text, params });
        const result = _queryResults.shift();
        if (result instanceof Error) throw result;
        return result || { rows: [] };
    },
    transaction: async (callback) => {
        const client = {
            query: async (text, params) => {
                _queryLog.push({ text, params });
                const result = _queryResults.shift();
                if (result instanceof Error) throw result;
                return result || { rows: [] };
            }
        };
        return callback(client);
    },
    _pushResult: (result) => _queryResults.push(result),
    _pushResults: (results) => _queryResults.push(...results),
    _getLog: () => _queryLog,
    _reset: () => {
        _queryResults.length = 0;
        _queryLog = [];
    }
};

// =========================================
// Cache Mock
// =========================================

const _cacheStore = new Map();

const mockCache = {
    init: async () => {},
    healthCheck: async () => true,
    get: async (key) => _cacheStore.has(key) ? _cacheStore.get(key) : null,
    set: async (key, value) => _cacheStore.set(key, value),
    del: async (key) => _cacheStore.delete(key),
    zadd: async () => {},
    zrevrange: async () => [],
    zrevrank: async () => null,
    zscore: async () => null,
    zcard: async () => 0,
    incr: async () => 1,
    expire: async () => {},
    _reset: () => _cacheStore.clear()
};

// =========================================
// Stripe Mock
// =========================================

let _stripeCallLog = [];

const mockStripe = {
    init: () => {},
    getClient: () => ({}),
    createCustomer: async (params) => {
        _stripeCallLog.push({ method: 'createCustomer', params });
        return { id: 'cus_test_123', email: params.email };
    },
    createSubscription: async (params) => {
        _stripeCallLog.push({ method: 'createSubscription', params });
        return {
            id: 'sub_test_123',
            customer: params.customerId,
            status: params.trialDays > 0 ? 'trialing' : 'active',
            items: { data: [{ price: { id: params.priceId } }] },
            trial_start: params.trialDays > 0 ? Math.floor(Date.now() / 1000) : null,
            trial_end: params.trialDays > 0 ? Math.floor(Date.now() / 1000) + params.trialDays * 86400 : null,
            current_period_start: Math.floor(Date.now() / 1000),
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
            metadata: params.metadata || {},
            latest_invoice: { payment_intent: { client_secret: 'pi_secret_test' } }
        };
    },
    cancelSubscription: async (subId, opts) => {
        _stripeCallLog.push({ method: 'cancelSubscription', subId, opts });
        return {
            id: subId,
            status: opts?.immediate ? 'canceled' : 'active',
            cancel_at_period_end: !opts?.immediate,
            cancel_at: opts?.immediate ? null : Math.floor(Date.now() / 1000) + 30 * 86400
        };
    },
    resumeSubscription: async (subId) => {
        _stripeCallLog.push({ method: 'resumeSubscription', subId });
        return { id: subId, status: 'active', cancel_at_period_end: false, cancel_at: null };
    },
    getSubscription: async (subId) => {
        _stripeCallLog.push({ method: 'getSubscription', subId });
        return {
            id: subId,
            customer: 'cus_test_123',
            status: 'active',
            items: { data: [{ price: { id: 'price_test' } }] },
            current_period_start: Math.floor(Date.now() / 1000),
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
            metadata: { plan_tier: 'pro' }
        };
    },
    createBillingPortalSession: async (customerId, returnUrl) => {
        _stripeCallLog.push({ method: 'createBillingPortalSession', customerId, returnUrl });
        return { url: 'https://billing.stripe.com/session/test_123' };
    },
    createCheckoutSession: async (params) => {
        _stripeCallLog.push({ method: 'createCheckoutSession', params });
        return { url: 'https://checkout.stripe.com/session/test_123' };
    },
    constructWebhookEvent: (rawBody, signature) => {
        const payload = JSON.parse(rawBody);
        return payload; // Skip signature verification in tests
    },
    createUsageRecord: async (itemId, quantity) => {
        _stripeCallLog.push({ method: 'createUsageRecord', itemId, quantity });
        return { id: 'ur_test_123' };
    },
    _getLog: () => _stripeCallLog,
    _reset: () => { _stripeCallLog = []; }
};

// =========================================
// Module Injection
// =========================================

/**
 * Override require() for a module to inject mocks.
 * Uses Node.js module cache manipulation.
 */
function injectMocks() {
    // Override the actual modules in require cache
    const path = require('path');

    const dbPath = path.resolve(__dirname, '../models/db.js');
    const cachePath = path.resolve(__dirname, '../services/cache.js');
    const stripePath = path.resolve(__dirname, '../services/stripe.js');

    require.cache[require.resolve(dbPath)] = {
        id: dbPath,
        filename: dbPath,
        loaded: true,
        exports: mockDb
    };

    require.cache[require.resolve(cachePath)] = {
        id: cachePath,
        filename: cachePath,
        loaded: true,
        exports: mockCache
    };

    require.cache[require.resolve(stripePath)] = {
        id: stripePath,
        filename: stripePath,
        loaded: true,
        exports: mockStripe
    };
}

function resetAll() {
    mockDb._reset();
    mockCache._reset();
    mockStripe._reset();
}

/**
 * Create a mock JWT token for testing authenticated routes.
 */
function createTestToken(playerId = 'player_test_1', tenantId = 'stem_default') {
    const jwt = require('jsonwebtoken');
    return jwt.sign({ playerId, tenantId }, 'change-me-in-production', { expiresIn: '1h' });
}

module.exports = {
    mockDb,
    mockCache,
    mockStripe,
    injectMocks,
    resetAll,
    createTestToken
};
