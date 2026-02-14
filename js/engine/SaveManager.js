/**
 * SaveManager.js
 * ================
 * Local persistence layer using localStorage with cloud sync support.
 * Handles player profiles, game progress, scores, ratings, and
 * offline-first caching with eventual consistency to the cloud API.
 *
 * Designed for SaaS scale: local cache reduces API calls,
 * dirty-flag tracking ensures minimal sync payloads.
 */

const SaveManager = (() => {
    'use strict';

    const STORAGE_PREFIX = 'stem_adventures_';
    const SYNC_QUEUE_KEY = STORAGE_PREFIX + 'sync_queue';
    const PLAYER_KEY = STORAGE_PREFIX + 'player';
    const PROGRESS_KEY = STORAGE_PREFIX + 'progress';
    const SETTINGS_KEY = STORAGE_PREFIX + 'settings';
    const VERSION = 1;

    /** In-memory cache of player data */
    let _playerData = null;
    let _progressData = null;
    let _settingsData = null;
    let _syncQueue = [];
    let _isDirty = false;

    // =========================================
    // Initialization
    // =========================================

    /**
     * Initialize the SaveManager. Loads data from localStorage into memory.
     */
    function init() {
        _playerData = _load(PLAYER_KEY) || _defaultPlayerData();
        _progressData = _load(PROGRESS_KEY) || _defaultProgressData();
        _settingsData = _load(SETTINGS_KEY) || _defaultSettings();
        _syncQueue = _load(SYNC_QUEUE_KEY) || [];

        // Ensure version migration
        if (_playerData._version !== VERSION) {
            _migrateData();
        }

        console.log(`SaveManager: Initialized for player "${_playerData.displayName}"`);
        return _playerData;
    }

    // =========================================
    // Player Profile
    // =========================================

    function _defaultPlayerData() {
        return {
            _version: VERSION,
            playerId: _generateId(),
            displayName: 'Explorer',
            avatarCharacter: 'guha',
            totalScore: 0,
            totalPlayTime: 0, // seconds
            gamesPlayed: 0,
            achievements: [],
            createdAt: Date.now(),
            lastLoginAt: Date.now(),
            authToken: null,  // Set after cloud auth
            isGuest: true
        };
    }

    function getPlayer() {
        if (!_playerData) init();
        return { ..._playerData };
    }

    function updatePlayer(updates) {
        if (!_playerData) init();
        Object.assign(_playerData, updates);
        _playerData.lastLoginAt = Date.now();
        _save(PLAYER_KEY, _playerData);
        _queueSync('player_update', { player: _playerData });
        return _playerData;
    }

    function setAuthToken(token) {
        _playerData.authToken = token;
        _playerData.isGuest = false;
        _save(PLAYER_KEY, _playerData);
    }

    // =========================================
    // Game Progress & Scores
    // =========================================

    function _defaultProgressData() {
        return {
            _version: VERSION,
            games: {}
            // Each game entry: {
            //   highScore: 0,
            //   bestTime: null,
            //   level: 1,
            //   stars: 0,        // 0-3 star rating
            //   playCount: 0,
            //   totalScore: 0,
            //   lastPlayed: null,
            //   unlocked: true,
            //   customData: {}   // Game-specific save data
            // }
        };
    }

    /**
     * Get progress for a specific game.
     */
    function getGameProgress(gameId) {
        if (!_progressData) init();
        return _progressData.games[gameId] || _defaultGameEntry();
    }

    /**
     * Get progress for all games.
     */
    function getAllProgress() {
        if (!_progressData) init();
        return { ..._progressData.games };
    }

    function _defaultGameEntry() {
        return {
            highScore: 0,
            bestTime: null,
            level: 1,
            stars: 0,
            playCount: 0,
            totalScore: 0,
            lastPlayed: null,
            unlocked: true,
            customData: {}
        };
    }

    /**
     * Save a game score. Automatically calculates star rating.
     *
     * @param {string} gameId - The game identifier.
     * @param {number} score - Score achieved this session.
     * @param {Object} [extras] - Additional data (time, level, customData).
     * @returns {Object} Updated game progress with isNewHigh flag.
     */
    function saveScore(gameId, score, extras = {}) {
        if (!_progressData) init();

        let entry = _progressData.games[gameId];
        if (!entry) {
            entry = _defaultGameEntry();
            _progressData.games[gameId] = entry;
        }

        const isNewHigh = score > entry.highScore;

        entry.playCount++;
        entry.totalScore += score;
        entry.lastPlayed = Date.now();

        if (isNewHigh) {
            entry.highScore = score;
        }

        if (extras.time && (!entry.bestTime || extras.time < entry.bestTime)) {
            entry.bestTime = extras.time;
        }

        if (extras.level && extras.level > entry.level) {
            entry.level = extras.level;
        }

        if (extras.customData) {
            Object.assign(entry.customData, extras.customData);
        }

        // Calculate star rating (0-3) based on score thresholds
        entry.stars = _calculateStars(gameId, entry.highScore);

        // Update player totals
        _playerData.totalScore += score;
        _playerData.gamesPlayed++;

        // Persist locally
        _save(PROGRESS_KEY, _progressData);
        _save(PLAYER_KEY, _playerData);

        // Queue for cloud sync
        _queueSync('score_submit', {
            gameId,
            score,
            highScore: entry.highScore,
            stars: entry.stars,
            level: entry.level,
            playCount: entry.playCount,
            timestamp: entry.lastPlayed
        });

        return { ...entry, isNewHigh };
    }

    /**
     * Calculate star rating based on game-specific thresholds.
     */
    function _calculateStars(gameId, score) {
        // Default thresholds (can be overridden per game)
        const thresholds = _getStarThresholds(gameId);
        if (score >= thresholds[2]) return 3;
        if (score >= thresholds[1]) return 2;
        if (score >= thresholds[0]) return 1;
        return 0;
    }

    function _getStarThresholds(gameId) {
        // Per-game star thresholds [1-star, 2-star, 3-star]
        const thresholds = {
            PhysicsMasterBilliards: [200, 600, 1500],
            STEMProjectVolley: [300, 800, 1500],
            LogicronsGridShift: [100, 300, 500],
            DroneDefense: [200, 500, 1000],
            LabBreach: [150, 400, 800],
            GeologyDeepDive: [100, 300, 600],
            CampusDash: [500, 2000, 5000],
            SafetyFirstDefense: [200, 500, 1000],
            GravityShiftRun: [200, 500, 1500],
            DemoDay: [100, 250, 500],
            ChemistryEscape: [200, 500, 1000],
            RoverFieldTest: [200, 500, 1000],
            HydroLogicPuzzles: [100, 300, 500],
            ColorLabQuest: [200, 500, 1000],
            CableCarConundrum: [100, 300, 600],
            FindThePrincipal: [200, 500, 1000],
            FormulaSTEM: [300, 600, 1200],
            CampusGuard: [100, 300, 800],
            HistoryVaultEscape: [100, 300, 500],
            MolecularSplit: [200, 500, 1000],
            HeavyGearDelivery: [200, 500, 1000],
            AeroEngineering: [200, 500, 1000],
            RobotRepairBay: [100, 300, 500],
            ParkourLab: [300, 1000, 3000],
            STEMCelebration: [500, 1500, 3000]
        };
        return thresholds[gameId] || [100, 300, 500];
    }

    /**
     * Save game-specific custom data (e.g., unlocked items, level state).
     */
    function saveCustomData(gameId, data) {
        if (!_progressData) init();
        let entry = _progressData.games[gameId];
        if (!entry) {
            entry = _defaultGameEntry();
            _progressData.games[gameId] = entry;
        }
        Object.assign(entry.customData, data);
        _save(PROGRESS_KEY, _progressData);
        _queueSync('custom_data', { gameId, customData: entry.customData });
    }

    // =========================================
    // Settings
    // =========================================

    function _defaultSettings() {
        return {
            _version: VERSION,
            musicVolume: 0.7,
            sfxVolume: 0.8,
            musicEnabled: true,
            sfxEnabled: true,
            showFPS: false,
            touchSensitivity: 1.0,
            language: 'en',
            colorBlindMode: false,
            reducedMotion: false
        };
    }

    function getSettings() {
        if (!_settingsData) init();
        return { ..._settingsData };
    }

    function updateSettings(updates) {
        if (!_settingsData) init();
        Object.assign(_settingsData, updates);
        _save(SETTINGS_KEY, _settingsData);
        _queueSync('settings_update', { settings: _settingsData });
    }

    // =========================================
    // Sync Queue (Offline-First)
    // =========================================

    /**
     * Queue a sync operation for the cloud API.
     * Operations are batched and sent when connectivity is available.
     */
    function _queueSync(action, payload) {
        _syncQueue.push({
            id: _generateId(),
            action,
            payload,
            timestamp: Date.now(),
            retries: 0
        });
        _isDirty = true;
        _save(SYNC_QUEUE_KEY, _syncQueue);
    }

    /**
     * Get pending sync operations.
     */
    function getSyncQueue() {
        return [..._syncQueue];
    }

    /**
     * Mark sync operations as completed (remove from queue).
     */
    function clearSyncItems(itemIds) {
        _syncQueue = _syncQueue.filter(item => !itemIds.includes(item.id));
        _save(SYNC_QUEUE_KEY, _syncQueue);
        _isDirty = _syncQueue.length > 0;
    }

    /**
     * Check if there are pending sync operations.
     */
    function hasPendingSync() {
        return _syncQueue.length > 0;
    }

    // =========================================
    // Merge cloud data with local (conflict resolution)
    // =========================================

    /**
     * Merge cloud data into local storage.
     * Uses "last-write-wins" with timestamp comparison,
     * but always keeps the higher score.
     *
     * @param {Object} cloudData - Data from the cloud API.
     */
    function mergeCloudData(cloudData) {
        if (!_progressData) init();

        if (cloudData.player) {
            // Keep higher total score
            if (cloudData.player.totalScore > _playerData.totalScore) {
                _playerData.totalScore = cloudData.player.totalScore;
            }
            if (cloudData.player.gamesPlayed > _playerData.gamesPlayed) {
                _playerData.gamesPlayed = cloudData.player.gamesPlayed;
            }
            _playerData.achievements = _mergeArraysUnique(
                _playerData.achievements,
                cloudData.player.achievements || []
            );
            _save(PLAYER_KEY, _playerData);
        }

        if (cloudData.progress) {
            Object.entries(cloudData.progress).forEach(([gameId, cloudEntry]) => {
                const local = _progressData.games[gameId] || _defaultGameEntry();

                // Always keep the higher high score
                local.highScore = Math.max(local.highScore, cloudEntry.highScore || 0);
                local.stars = Math.max(local.stars, cloudEntry.stars || 0);
                local.level = Math.max(local.level, cloudEntry.level || 1);
                local.playCount = Math.max(local.playCount, cloudEntry.playCount || 0);
                local.totalScore = Math.max(local.totalScore, cloudEntry.totalScore || 0);

                // Best time: keep lowest (fastest)
                if (cloudEntry.bestTime && (!local.bestTime || cloudEntry.bestTime < local.bestTime)) {
                    local.bestTime = cloudEntry.bestTime;
                }

                // Last played: keep most recent
                if (cloudEntry.lastPlayed && (!local.lastPlayed || cloudEntry.lastPlayed > local.lastPlayed)) {
                    local.lastPlayed = cloudEntry.lastPlayed;
                }

                _progressData.games[gameId] = local;
            });
            _save(PROGRESS_KEY, _progressData);
        }

        if (cloudData.settings) {
            // Cloud settings override local only if newer
            if (cloudData.settings._timestamp > (_settingsData._timestamp || 0)) {
                Object.assign(_settingsData, cloudData.settings);
                _save(SETTINGS_KEY, _settingsData);
            }
        }
    }

    // =========================================
    // Statistics
    // =========================================

    /**
     * Get aggregate statistics across all games.
     */
    function getStats() {
        if (!_progressData) init();

        const games = Object.values(_progressData.games);
        const totalStars = games.reduce((sum, g) => sum + g.stars, 0);
        const maxStars = games.length * 3;
        const gamesStarted = games.filter(g => g.playCount > 0).length;
        const gamesCompleted = games.filter(g => g.stars >= 1).length;
        const gamesMastered = games.filter(g => g.stars === 3).length;

        return {
            totalScore: _playerData.totalScore,
            totalPlayTime: _playerData.totalPlayTime,
            gamesPlayed: _playerData.gamesPlayed,
            gamesStarted,
            gamesCompleted,
            gamesMastered,
            totalStars,
            maxStars,
            starPercentage: maxStars > 0 ? Math.round((totalStars / maxStars) * 100) : 0,
            achievements: _playerData.achievements.length
        };
    }

    // =========================================
    // Data Management
    // =========================================

    /**
     * Export all save data as JSON (for backup/transfer).
     */
    function exportData() {
        return JSON.stringify({
            player: _playerData,
            progress: _progressData,
            settings: _settingsData,
            exportedAt: Date.now(),
            version: VERSION
        });
    }

    /**
     * Import save data from JSON string.
     */
    function importData(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            if (data.player) {
                _playerData = data.player;
                _save(PLAYER_KEY, _playerData);
            }
            if (data.progress) {
                _progressData = data.progress;
                _save(PROGRESS_KEY, _progressData);
            }
            if (data.settings) {
                _settingsData = data.settings;
                _save(SETTINGS_KEY, _settingsData);
            }
            return true;
        } catch (e) {
            console.error('SaveManager: Import failed', e);
            return false;
        }
    }

    /**
     * Reset all data (factory reset).
     */
    function resetAll() {
        _playerData = _defaultPlayerData();
        _progressData = _defaultProgressData();
        _settingsData = _defaultSettings();
        _syncQueue = [];
        _save(PLAYER_KEY, _playerData);
        _save(PROGRESS_KEY, _progressData);
        _save(SETTINGS_KEY, _settingsData);
        _save(SYNC_QUEUE_KEY, _syncQueue);
    }

    // =========================================
    // Internal Helpers
    // =========================================

    function _save(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e) {
            console.error(`SaveManager: Failed to save ${key}`, e);
        }
    }

    function _load(key) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            console.error(`SaveManager: Failed to load ${key}`, e);
            return null;
        }
    }

    function _generateId() {
        return 'xxxx-xxxx-xxxx'.replace(/x/g, () =>
            Math.floor(Math.random() * 16).toString(16)
        );
    }

    function _mergeArraysUnique(a, b) {
        return [...new Set([...a, ...b])];
    }

    function _migrateData() {
        // Future migration logic goes here
        _playerData._version = VERSION;
        _save(PLAYER_KEY, _playerData);
    }

    return {
        init,
        // Player
        getPlayer,
        updatePlayer,
        setAuthToken,
        // Progress
        getGameProgress,
        getAllProgress,
        saveScore,
        saveCustomData,
        // Settings
        getSettings,
        updateSettings,
        // Sync
        getSyncQueue,
        clearSyncItems,
        hasPendingSync,
        mergeCloudData,
        // Stats
        getStats,
        // Data management
        exportData,
        importData,
        resetAll
    };
})();
