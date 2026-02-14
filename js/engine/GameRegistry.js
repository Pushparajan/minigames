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

    return { register, getAll, getById };
})();
