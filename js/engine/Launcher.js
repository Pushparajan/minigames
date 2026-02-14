/**
 * Launcher.js
 * =============
 * Main entry point. Builds the game selection grid from the GameRegistry
 * and initializes Phaser when a game is selected.
 * Supports category-based filtering and grouped display.
 */

const Launcher = (() => {
    'use strict';

    let _phaserInstance = null;
    let _activeCategory = 'all';

    /**
     * Initialize the launcher UI.
     */
    async function init() {
        SaveManager.init();

        // Load categories and custom games before building the grid
        await GameRegistry.loadCategories().catch(() => {});
        await GameRegistry.loadCustomGames().catch(() => {});

        _buildCategoryFilters();
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
     * Build category filter tabs above the game grid.
     */
    function _buildCategoryFilters() {
        const container = document.getElementById('category-filters');
        if (!container) return;

        const categories = GameRegistry.getCategories();
        if (categories.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.innerHTML = '';

        // "All" tab
        const allBtn = document.createElement('button');
        allBtn.className = 'category-tab category-tab-active';
        allBtn.textContent = 'All Games';
        allBtn.dataset.category = 'all';
        allBtn.setAttribute('aria-pressed', 'true');
        allBtn.addEventListener('click', () => _filterByCategory('all'));
        container.appendChild(allBtn);

        // Category tabs
        for (const cat of categories) {
            const btn = document.createElement('button');
            btn.className = 'category-tab';
            btn.dataset.category = cat.id;
            btn.setAttribute('aria-pressed', 'false');
            btn.innerHTML = `<span class="category-tab-icon" aria-hidden="true">${cat.icon_emoji || ''}</span> ${cat.name}`;
            btn.addEventListener('click', () => _filterByCategory(cat.id));
            container.appendChild(btn);
        }
    }

    /**
     * Filter games by category.
     */
    function _filterByCategory(categoryId) {
        _activeCategory = categoryId;

        // Update active tab
        const tabs = document.querySelectorAll('.category-tab');
        tabs.forEach(t => {
            const isActive = t.dataset.category === categoryId;
            t.classList.toggle('category-tab-active', isActive);
            t.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });

        // Show/hide category sections
        if (categoryId === 'all') {
            document.querySelectorAll('.category-section').forEach(s => s.style.display = '');
        } else {
            document.querySelectorAll('.category-section').forEach(s => {
                s.style.display = s.dataset.categoryId === categoryId ? '' : 'none';
            });
        }
    }

    /**
     * Build the game selection grid from registered games, grouped by category.
     */
    function _buildGrid() {
        const grid = document.getElementById('game-grid');
        grid.innerHTML = '';

        const grouped = GameRegistry.getGroupedByCategory();
        let globalIndex = 0;

        if (grouped.length === 0) {
            // Fallback: no categories, flat list
            const games = GameRegistry.getAll();
            games.forEach((game, index) => {
                grid.appendChild(_createGameCard(game, index));
            });
            return;
        }

        for (const group of grouped) {
            const section = document.createElement('section');
            section.className = 'category-section';
            section.dataset.categoryId = group.category.id;
            section.setAttribute('aria-label', group.category.name + ' games');

            // Section header
            const header = document.createElement('div');
            header.className = 'category-section-header';
            header.innerHTML = `
                <span class="category-section-icon" style="background:${group.category.icon_color || '#667eea'}" aria-hidden="true">${group.category.icon_emoji || ''}</span>
                <h2>${group.category.name}</h2>
                <span class="category-section-count">${group.games.length} game${group.games.length !== 1 ? 's' : ''}</span>
            `;
            section.appendChild(header);

            // Games grid within category
            const catGrid = document.createElement('div');
            catGrid.className = 'game-grid category-game-grid';
            catGrid.setAttribute('role', 'list');

            for (const game of group.games) {
                catGrid.appendChild(_createGameCard(game, globalIndex));
                globalIndex++;
            }

            section.appendChild(catGrid);
            grid.appendChild(section);
        }
    }

    /**
     * Create a game card element.
     */
    function _createGameCard(game, index) {
        const card = document.createElement('article');
        card.className = 'game-card';
        card.dataset.gameId = game.id;
        card.setAttribute('role', 'listitem');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', `Play ${game.title}`);

        const progress = SaveManager.getGameProgress(game.id);
        const starsHtml = _renderStars(progress.stars);
        const highScoreHtml = progress.highScore > 0
            ? `<div class="card-highscore">Best: ${progress.highScore.toLocaleString()}</div>`
            : '';

        card.innerHTML = `
            <span class="card-number" aria-hidden="true">#${index + 1}</span>
            <div class="card-icon" style="background:${game.iconColor || '#333'}" aria-hidden="true">
                ${game.iconEmoji || '?'}
            </div>
            <h3>${game.title}</h3>
            <div class="card-stars" aria-label="${progress.stars} of 3 stars earned">${starsHtml}</div>
            ${highScoreHtml}
            <div class="card-character">${_getCharacterLabel(game.character)}</div>
            <div class="card-mechanic">${game.mechanic}</div>
        `;

        card.addEventListener('click', () => _launchGame(game));
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                _launchGame(game);
            }
        });
        card.addEventListener('touchend', (e) => {
            e.preventDefault();
            _launchGame(game);
        });

        return card;
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

        // Build physics config based on game requirements
        const physicsConfig = {};
        if (game.physics === 'matter') {
            physicsConfig.default = 'matter';
            physicsConfig.matter = { gravity: { y: 0 }, debug: false };
        } else if (game.physics === 'arcade') {
            physicsConfig.default = 'arcade';
            physicsConfig.arcade = { gravity: { y: 0 }, debug: false };
        }

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
            physics: Object.keys(physicsConfig).length > 0 ? physicsConfig : undefined,
            scene: [BootScene, game.scene],
            input: {
                activePointers: 3  // Multi-touch support
            }
        });

        // Start with boot scene, passing target game ID
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

        // Restore focus to the launcher heading
        const header = document.querySelector('.launcher-header h1');
        if (header) header.focus();
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
                ? '<span class="star star-earned" aria-hidden="true">&#9733;</span>'
                : '<span class="star star-empty" aria-hidden="true">&#9734;</span>';
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
