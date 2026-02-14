/**
 * Launcher.js
 * =============
 * Main entry point. Builds the game selection grid from the GameRegistry
 * and initializes Phaser when a game is selected.
 */

const Launcher = (() => {
    'use strict';

    let _phaserInstance = null;

    /**
     * Initialize the launcher UI.
     */
    function init() {
        SaveManager.init();
        _buildGrid();
        _bindBackButton();

        // Init cloud sync (non-blocking, fails silently if no API configured)
        try {
            CloudSyncAPI.init({ apiUrl: '/api/v1' });
        } catch (e) {
            console.log('CloudSyncAPI: Running in offline mode');
        }
    }

    /**
     * Build the game selection grid from registered games.
     */
    function _buildGrid() {
        const grid = document.getElementById('game-grid');
        const games = GameRegistry.getAll();

        games.forEach((game, index) => {
            const card = document.createElement('div');
            card.className = 'game-card';
            card.dataset.gameId = game.id;

            const progress = SaveManager.getGameProgress(game.id);
            const starsHtml = _renderStars(progress.stars);
            const highScoreHtml = progress.highScore > 0
                ? `<div class="card-highscore">Best: ${progress.highScore.toLocaleString()}</div>`
                : '';

            card.innerHTML = `
                <span class="card-number">#${index + 1}</span>
                <div class="card-icon" style="background:${game.iconColor || '#333'}">
                    ${game.iconEmoji || '?'}
                </div>
                <h3>${game.title}</h3>
                <div class="card-stars">${starsHtml}</div>
                ${highScoreHtml}
                <div class="card-character">${_getCharacterLabel(game.character)}</div>
                <div class="card-mechanic">${game.mechanic}</div>
            `;

            card.addEventListener('click', () => _launchGame(game));
            card.addEventListener('touchend', (e) => {
                e.preventDefault();
                _launchGame(game);
            });

            grid.appendChild(card);
        });
    }

    /**
     * Get a readable character label.
     */
    function _getCharacterLabel(charId) {
        if (!charId) return '';
        // Handle "vs" characters like "sofia_vs_rex"
        if (charId.includes('_vs_')) {
            const parts = charId.split('_vs_');
            const a = CharacterFactory.getInfo(parts[0]);
            const b = CharacterFactory.getInfo(parts[1]);
            return `${a ? a.name : parts[0]} vs ${b ? b.name : parts[1]}`;
        }
        const info = CharacterFactory.getInfo(charId);
        return info ? `${info.name} — ${info.role}` : charId;
    }

    /**
     * Launch a specific game by destroying the current Phaser instance
     * (if any) and creating a new one with the target game's scene.
     */
    function _launchGame(game) {
        // Show game container, hide launcher
        document.getElementById('launcher').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        document.getElementById('hud-title').textContent = game.title;
        document.getElementById('hud-score').textContent = 'Score: 0';

        // Destroy existing Phaser instance
        if (_phaserInstance) {
            _phaserInstance.destroy(true);
            _phaserInstance = null;
            // Clear the container
            document.getElementById('phaser-container').innerHTML = '';
        }

        // Calculate game dimensions (responsive)
        const container = document.getElementById('phaser-container');
        const w = container.clientWidth;
        const h = container.clientHeight;

        // Create new Phaser instance
        _phaserInstance = new Phaser.Game({
            type: Phaser.AUTO,
            parent: 'phaser-container',
            width: Math.min(w, 960),
            height: Math.min(h, 640),
            backgroundColor: '#1a1a2e',
            scale: {
                mode: Phaser.Scale.FIT,
                autoCenter: Phaser.Scale.CENTER_BOTH
            },
            physics: {
                default: 'matter',
                matter: {
                    gravity: { y: 0 },
                    debug: false
                },
                arcade: {
                    gravity: { y: 0 },
                    debug: false
                }
            },
            scene: [BootScene, game.scene],
            input: {
                activePointers: 3  // Multi-touch support
            }
        });

        // Start with boot scene, passing target game ID
        // The BootScene is already first in the scene list, so it auto-starts.
        // We just need to pass data. The scene manager starts the first scene
        // automatically; BootScene.init() reads the registry to find target.
        // Actually, we pass data via scene's registry:
        _phaserInstance.registry.set('targetGameId', game.id);

        // Override: directly start BootScene with data after game is ready
        _phaserInstance.events.once('ready', () => {
            const bootScene = _phaserInstance.scene.getScene('BootScene');
            if (bootScene) {
                bootScene.targetGameId = game.id;
            }
        });
    }

    /**
     * Bind the back button to return to the launcher.
     */
    function _bindBackButton() {
        document.getElementById('btn-back').addEventListener('click', _returnToLauncher);
    }

    /**
     * Destroy game and return to launcher.
     */
    function _returnToLauncher() {
        if (_phaserInstance) {
            _phaserInstance.destroy(true);
            _phaserInstance = null;
            document.getElementById('phaser-container').innerHTML = '';
        }

        document.getElementById('game-container').style.display = 'none';
        document.getElementById('launcher').style.display = 'block';

        // Refresh card progress indicators
        _refreshProgress();
    }

    /**
     * Refresh progress indicators on all cards.
     */
    function _refreshProgress() {
        const cards = document.querySelectorAll('.game-card');
        cards.forEach(card => {
            const gameId = card.dataset.gameId;
            if (!gameId) return;
            const progress = SaveManager.getGameProgress(gameId);
            const starsEl = card.querySelector('.card-stars');
            if (starsEl) starsEl.innerHTML = _renderStars(progress.stars);
            let hsEl = card.querySelector('.card-highscore');
            if (progress.highScore > 0) {
                if (!hsEl) {
                    hsEl = document.createElement('div');
                    hsEl.className = 'card-highscore';
                    const starsNode = card.querySelector('.card-stars');
                    if (starsNode) starsNode.after(hsEl);
                }
                hsEl.textContent = `Best: ${progress.highScore.toLocaleString()}`;
            }
        });
    }

    /**
     * Render star icons (0-3).
     */
    function _renderStars(count) {
        let html = '';
        for (let i = 0; i < 3; i++) {
            html += i < count
                ? '<span class="star star-earned">&#9733;</span>'
                : '<span class="star star-empty">&#9734;</span>';
        }
        return html;
    }

    /**
     * Update the HUD score display (callable from any game scene).
     */
    function updateScore(value) {
        const el = document.getElementById('hud-score');
        if (el) el.textContent = `Score: ${value}`;
    }

    /**
     * Save a game score via SaveManager (callable from any game scene).
     * @param {string} gameId
     * @param {number} score
     * @param {Object} [extras] - { time, level, customData }
     * @returns {Object} { highScore, stars, isNewHigh, ... }
     */
    function saveGameScore(gameId, score, extras = {}) {
        return SaveManager.saveScore(gameId, score, extras);
    }

    // Auto-init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return { init, updateScore, saveGameScore };
})();
