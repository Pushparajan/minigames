/**
 * GameRegistry.js
 * =================
 * Central registry for all STEM School Adventures games.
 * Each game registers itself here with metadata and a Scene class.
 * Supports category-based grouping fetched from the server.
 */

const GameRegistry = (() => {
    'use strict';

    const _games = [];
    let _categories = [];
    /** Map of gameId → [categoryId, ...] */
    const _gameCategoryMap = {};

    /**
     * Register a game into the system.
     *
     * @param {Object} config
     * @param {string} config.id           - Unique game identifier.
     * @param {string} config.title        - Display title.
     * @param {string} config.classic      - Original Miniclip game reference.
     * @param {string} config.character    - Lead character ID from CharacterFactory.
     * @param {string} config.mechanic     - Short description of key mechanic.
     * @param {string} config.iconColor    - CSS color for the card icon background.
     * @param {string} config.iconEmoji    - Simple emoji/symbol for the card.
     * @param {typeof Phaser.Scene} config.scene - The Phaser Scene class.
     */
    function register(config) {
        if (_games.find(g => g.id === config.id)) {
            console.warn(`GameRegistry: Duplicate game ID "${config.id}"`);
            return;
        }
        _games.push(config);
    }

    /**
     * Get all registered games in order.
     */
    function getAll() {
        return [..._games];
    }

    /**
     * Find a game by ID.
     */
    function getById(id) {
        return _games.find(g => g.id === id) || null;
    }

    /**
     * Get all loaded categories with their game IDs.
     */
    function getCategories() {
        return [..._categories];
    }

    /**
     * Get category IDs assigned to a game.
     */
    function getGameCategories(gameId) {
        return _gameCategoryMap[gameId] || [];
    }

    /**
     * Get all games grouped by category.
     * Returns an array of { category, games } objects.
     * Games not in any category are grouped under "Other".
     */
    function getGroupedByCategory() {
        const grouped = [];
        const assignedGameIds = new Set();

        for (const cat of _categories) {
            const catGames = [];
            for (const gid of (cat.gameIds || [])) {
                const game = _games.find(g => g.id === gid);
                if (game) {
                    catGames.push(game);
                    assignedGameIds.add(gid);
                }
            }
            if (catGames.length > 0) {
                grouped.push({ category: cat, games: catGames });
            }
        }

        // Uncategorized games
        const uncategorized = _games.filter(g => !assignedGameIds.has(g.id));
        if (uncategorized.length > 0) {
            grouped.push({
                category: { id: 'uncategorized', name: 'Other', slug: 'other', icon_emoji: '🎮', icon_color: '#666', sort_order: 999 },
                games: uncategorized
            });
        }

        return grouped;
    }

    /**
     * Load categories from the API.
     */
    async function loadCategories() {
        try {
            const res = await fetch('/api/v1/games/categories');
            if (!res.ok) return;
            const data = await res.json();
            if (!data.categories) return;

            _categories = data.categories;

            // Build reverse map: gameId → [categoryId, ...]
            for (const cat of _categories) {
                for (const gid of (cat.gameIds || [])) {
                    if (!_gameCategoryMap[gid]) _gameCategoryMap[gid] = [];
                    _gameCategoryMap[gid].push(cat.id);
                }
            }
        } catch (err) {
            console.warn('GameRegistry: Could not fetch categories:', err);
        }
    }

    /**
     * Load custom (admin-added) games from the API and register them.
     * Each custom game's sceneCode is evaluated to produce a Phaser Scene class.
     */
    async function loadCustomGames() {
        try {
            const res = await fetch('/api/v1/games/custom');
            if (!res.ok) return;
            const data = await res.json();
            if (!data.games || data.games.length === 0) return;

            data.games.forEach(g => {
                if (_games.find(existing => existing.id === g.id)) return;
                try {
                    // Evaluate the scene code to get a Phaser.Scene class
                    const SceneClass = new Function('Phaser', 'Launcher', 'CharacterFactory', g.scene_code)(Phaser, typeof Launcher !== 'undefined' ? Launcher : null, typeof CharacterFactory !== 'undefined' ? CharacterFactory : null);
                    register({
                        id: g.id,
                        title: g.title,
                        classic: g.classic || '',
                        character: g.character_id || '',
                        mechanic: g.mechanic || '',
                        iconColor: g.icon_color || '#333',
                        iconEmoji: g.icon_emoji || '?',
                        scene: SceneClass,
                        isCustom: true
                    });

                    // Update category map from custom game data
                    if (Array.isArray(g.categories)) {
                        _gameCategoryMap[g.id] = g.categories;
                    }
                } catch (err) {
                    console.warn(`GameRegistry: Failed to load custom game "${g.id}":`, err);
                }
            });
        } catch (err) {
            console.warn('GameRegistry: Could not fetch custom games:', err);
        }
    }

    return { register, getAll, getById, getCategories, getGameCategories, getGroupedByCategory, loadCategories, loadCustomGames };
})();
