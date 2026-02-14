/**
 * GameRegistry.js
 * =================
 * Central registry for all 25 STEM School Adventures games.
 * Each game registers itself here with metadata and a Scene class.
 */

const GameRegistry = (() => {
    'use strict';

    const _games = [];

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
                } catch (err) {
                    console.warn(`GameRegistry: Failed to load custom game "${g.id}":`, err);
                }
            });
        } catch (err) {
            console.warn('GameRegistry: Could not fetch custom games:', err);
        }
    }

    return { register, getAll, getById, loadCustomGames };
})();
