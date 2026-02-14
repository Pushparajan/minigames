/**
 * CloudSyncAPI.js
 * ================
 * Browser-side client for the STEM Adventures cloud API.
 * Handles authentication, score submission, leaderboard queries,
 * and background sync of the SaveManager's offline queue.
 *
 * Designed for SaaS scale: exponential backoff, request batching,
 * JWT token refresh, and connection-aware sync scheduling.
 */

const CloudSyncAPI = (() => {
    'use strict';

    // =========================================
    // Configuration
    // =========================================

    let _baseUrl = '';  // Set via init()
    let _apiKey = '';   // Tenant API key
    let _token = null;  // JWT access token
    let _refreshToken = null;
    let _syncInterval = null;
    let _isOnline = navigator.onLine;
    let _isSyncing = false;
    let _retryCount = 0;
    const MAX_RETRIES = 5;
    const BASE_DELAY = 1000;
    const SYNC_INTERVAL_MS = 30000; // 30 seconds
    const BATCH_SIZE = 20;

    // =========================================
    // Initialization
    // =========================================

    /**
     * Initialize the cloud sync client.
     *
     * @param {Object} config
     * @param {string} config.apiUrl - Base URL for the API.
     * @param {string} config.apiKey - Tenant API key.
     */
    function init(config = {}) {
        _baseUrl = config.apiUrl || '/api/v1';
        _apiKey = config.apiKey || '';

        // Restore tokens from SaveManager
        const player = SaveManager.getPlayer();
        if (player.authToken) {
            _token = player.authToken;
        }

        // Listen for connectivity changes
        window.addEventListener('online', _onOnline);
        window.addEventListener('offline', _onOffline);

        // Start background sync loop
        _startSyncLoop();

        console.log('CloudSyncAPI: Initialized');
    }

    function destroy() {
        window.removeEventListener('online', _onOnline);
        window.removeEventListener('offline', _onOffline);
        if (_syncInterval) {
            clearInterval(_syncInterval);
            _syncInterval = null;
        }
    }

    // =========================================
    // Authentication
    // =========================================

    /**
     * Register as a guest player. Returns a session token.
     */
    async function registerGuest() {
        const player = SaveManager.getPlayer();
        const res = await _request('POST', '/auth/guest', {
            playerId: player.playerId,
            displayName: player.displayName,
            avatarCharacter: player.avatarCharacter
        });

        if (res.token) {
            _token = res.token;
            _refreshToken = res.refreshToken;
            SaveManager.setAuthToken(res.token);
        }
        return res;
    }

    /**
     * Login with email/password for full accounts.
     */
    async function login(email, password) {
        const res = await _request('POST', '/auth/login', { email, password });
        if (res.token) {
            _token = res.token;
            _refreshToken = res.refreshToken;
            SaveManager.setAuthToken(res.token);

            // Merge cloud data into local
            if (res.playerData) {
                SaveManager.mergeCloudData(res.playerData);
            }
        }
        return res;
    }

    /**
     * Register a new full account.
     */
    async function register(email, password, displayName) {
        const player = SaveManager.getPlayer();
        const res = await _request('POST', '/auth/register', {
            email,
            password,
            displayName: displayName || player.displayName,
            playerId: player.playerId,
            avatarCharacter: player.avatarCharacter
        });

        if (res.token) {
            _token = res.token;
            _refreshToken = res.refreshToken;
            SaveManager.setAuthToken(res.token);
        }
        return res;
    }

    /**
     * Refresh the JWT access token.
     */
    async function refreshAuthToken() {
        if (!_refreshToken) return false;
        try {
            const res = await _request('POST', '/auth/refresh', {
                refreshToken: _refreshToken
            });
            if (res.token) {
                _token = res.token;
                _refreshToken = res.refreshToken || _refreshToken;
                SaveManager.setAuthToken(res.token);
                return true;
            }
        } catch (e) {
            console.warn('CloudSyncAPI: Token refresh failed', e);
        }
        return false;
    }

    // =========================================
    // Score Submission
    // =========================================

    /**
     * Submit a score to the cloud. Called automatically via sync queue,
     * but can be called directly for immediate submission.
     */
    async function submitScore(gameId, score, extras = {}) {
        return _request('POST', `/scores/${gameId}`, {
            score,
            ...extras,
            timestamp: Date.now()
        });
    }

    // =========================================
    // Leaderboards
    // =========================================

    /**
     * Get global leaderboard for a game.
     *
     * @param {string} gameId
     * @param {Object} [options]
     * @param {string} [options.period] - 'all', 'monthly', 'weekly', 'daily'
     * @param {number} [options.limit] - Number of entries (default 50)
     * @param {number} [options.offset] - Pagination offset
     */
    async function getLeaderboard(gameId, options = {}) {
        const params = new URLSearchParams({
            period: options.period || 'all',
            limit: options.limit || 50,
            offset: options.offset || 0
        });
        return _request('GET', `/leaderboards/${gameId}?${params}`);
    }

    /**
     * Get the current player's rank on a leaderboard.
     */
    async function getPlayerRank(gameId, period = 'all') {
        return _request('GET', `/leaderboards/${gameId}/me?period=${period}`);
    }

    /**
     * Get the leaderboard around the current player (nearby ranks).
     */
    async function getLeaderboardAroundPlayer(gameId, range = 5) {
        return _request('GET', `/leaderboards/${gameId}/around?range=${range}`);
    }

    /**
     * Get aggregate leaderboard across all games.
     */
    async function getGlobalLeaderboard(options = {}) {
        const params = new URLSearchParams({
            limit: options.limit || 50,
            offset: options.offset || 0
        });
        return _request('GET', `/leaderboards/global?${params}`);
    }

    // =========================================
    // Player Profile (Cloud)
    // =========================================

    /**
     * Get the player's cloud profile with merged stats.
     */
    async function getProfile() {
        return _request('GET', '/player/profile');
    }

    /**
     * Update player profile on the cloud.
     */
    async function updateProfile(updates) {
        return _request('PUT', '/player/profile', updates);
    }

    // =========================================
    // Background Sync
    // =========================================

    function _startSyncLoop() {
        // Immediate sync attempt
        _processSyncQueue();

        // Periodic sync
        _syncInterval = setInterval(() => {
            if (_isOnline && !_isSyncing) {
                _processSyncQueue();
            }
        }, SYNC_INTERVAL_MS);
    }

    /**
     * Process the SaveManager's sync queue in batches.
     */
    async function _processSyncQueue() {
        if (_isSyncing || !_isOnline || !_token) return;

        const queue = SaveManager.getSyncQueue();
        if (queue.length === 0) return;

        _isSyncing = true;

        try {
            // Process in batches
            const batch = queue.slice(0, BATCH_SIZE);
            const res = await _request('POST', '/sync/batch', {
                operations: batch.map(item => ({
                    id: item.id,
                    action: item.action,
                    payload: item.payload,
                    timestamp: item.timestamp
                }))
            });

            if (res.processed) {
                // Remove successfully processed items
                SaveManager.clearSyncItems(res.processed);
                _retryCount = 0;
            }

            // Handle merged data from cloud
            if (res.mergedData) {
                SaveManager.mergeCloudData(res.mergedData);
            }
        } catch (err) {
            console.warn('CloudSyncAPI: Sync batch failed', err);
            _retryCount++;
        } finally {
            _isSyncing = false;
        }
    }

    /**
     * Force an immediate sync attempt.
     */
    async function forceSync() {
        _retryCount = 0;
        return _processSyncQueue();
    }

    // =========================================
    // HTTP Client
    // =========================================

    async function _request(method, path, body = null) {
        const url = _baseUrl + path;
        const headers = {
            'Content-Type': 'application/json'
        };

        if (_apiKey) {
            headers['X-API-Key'] = _apiKey;
        }

        if (_token) {
            headers['Authorization'] = `Bearer ${_token}`;
        }

        const options = { method, headers };
        if (body && method !== 'GET') {
            options.body = JSON.stringify(body);
        }

        let lastError;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await fetch(url, options);

                // Token expired — attempt refresh once
                if (response.status === 401 && _refreshToken && attempt === 0) {
                    const refreshed = await refreshAuthToken();
                    if (refreshed) {
                        headers['Authorization'] = `Bearer ${_token}`;
                        continue; // Retry with new token
                    }
                }

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new APIError(response.status, errData.message || response.statusText, errData);
                }

                return await response.json();
            } catch (err) {
                lastError = err;
                if (err instanceof APIError && err.status < 500) {
                    throw err; // Don't retry client errors
                }
                // Exponential backoff for network/server errors
                if (attempt < MAX_RETRIES) {
                    await _delay(BASE_DELAY * Math.pow(2, attempt));
                }
            }
        }

        throw lastError;
    }

    // =========================================
    // Connectivity
    // =========================================

    function _onOnline() {
        _isOnline = true;
        _retryCount = 0;
        console.log('CloudSyncAPI: Online — starting sync');
        _processSyncQueue();
    }

    function _onOffline() {
        _isOnline = false;
        console.log('CloudSyncAPI: Offline — queuing locally');
    }

    function isOnline() {
        return _isOnline;
    }

    // =========================================
    // Helpers
    // =========================================

    function _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    class APIError extends Error {
        constructor(status, message, data = {}) {
            super(message);
            this.name = 'APIError';
            this.status = status;
            this.data = data;
        }
    }

    return {
        init,
        destroy,
        // Auth
        registerGuest,
        login,
        register,
        refreshAuthToken,
        // Scores
        submitScore,
        // Leaderboards
        getLeaderboard,
        getPlayerRank,
        getLeaderboardAroundPlayer,
        getGlobalLeaderboard,
        // Profile
        getProfile,
        updateProfile,
        // Sync
        forceSync,
        isOnline,
        // Error class
        APIError
    };
})();
