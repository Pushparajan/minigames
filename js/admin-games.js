/**
 * AdminGames.js
 * ===============
 * Admin panel for managing custom games and game categories.
 * Allows admins to add, edit, toggle, and delete games,
 * and manage categories for grouping games.
 */

const AdminGames = (() => {
    'use strict';

    const API_BASE = '/api/v1/admin/games';
    const API_PUBLIC = '/api/v1/games';
    let _games = [];
    let _categories = [];
    let _editingId = null;
    let _activeView = 'games'; // 'games' | 'categories'

    // =========================================
    // Show / Hide
    // =========================================

    async function show() {
        const token = localStorage.getItem('stem_auth_token');
        if (!token) {
            SiteUI.showLogin();
            return;
        }

        const overlay = document.getElementById('modal-overlay');
        overlay.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
        overlay.style.display = 'flex';
        document.getElementById('modal-admin-games').style.display = 'block';

        _showListView();
        await Promise.all([_loadGames(), _loadCategories()]);
    }

    // =========================================
    // Views
    // =========================================

    function _showListView() {
        document.getElementById('admin-games-list').style.display = 'block';
        document.getElementById('admin-games-form').style.display = 'none';
        document.getElementById('admin-categories-view').style.display = 'none';
        _editingId = null;
        _activeView = 'games';
        _updateViewTabs();
    }

    function showCategoriesView() {
        document.getElementById('admin-games-list').style.display = 'none';
        document.getElementById('admin-games-form').style.display = 'none';
        document.getElementById('admin-categories-view').style.display = 'block';
        _activeView = 'categories';
        _updateViewTabs();
        _renderCategories();
    }

    function _updateViewTabs() {
        const gamesTab = document.getElementById('ag-tab-games');
        const catsTab = document.getElementById('ag-tab-categories');
        if (gamesTab) gamesTab.classList.toggle('ag-tab-active', _activeView === 'games');
        if (catsTab) catsTab.classList.toggle('ag-tab-active', _activeView === 'categories');
    }

    function showAddForm() {
        _editingId = null;
        document.getElementById('admin-games-list').style.display = 'none';
        document.getElementById('admin-categories-view').style.display = 'none';
        document.getElementById('admin-games-form').style.display = 'block';
        document.getElementById('admin-games-form-title').textContent = 'Add New Game';
        _clearForm();
        document.getElementById('ag-id').disabled = false;
        _populateCategoryCheckboxes([]);
    }

    function showEditForm(gameId) {
        const game = _games.find(g => g.id === gameId);
        if (!game) return;

        _editingId = gameId;
        document.getElementById('admin-games-list').style.display = 'none';
        document.getElementById('admin-categories-view').style.display = 'none';
        document.getElementById('admin-games-form').style.display = 'block';
        document.getElementById('admin-games-form-title').textContent = 'Edit Game';

        document.getElementById('ag-id').value = game.id;
        document.getElementById('ag-id').disabled = true;
        document.getElementById('ag-title').value = game.title;
        document.getElementById('ag-classic').value = game.classic || '';
        document.getElementById('ag-character').value = game.character_id || '';
        document.getElementById('ag-mechanic').value = game.mechanic || '';
        document.getElementById('ag-icon-color').value = game.icon_color || '#333333';
        document.getElementById('ag-icon-emoji').value = game.icon_emoji || '';
        document.getElementById('ag-sort-order').value = game.sort_order || 100;
        document.getElementById('ag-scene-code').value = game.scene_code || '';

        const gameCats = Array.isArray(game.categories) ? game.categories : [];
        _populateCategoryCheckboxes(gameCats);
    }

    function _clearForm() {
        document.getElementById('ag-id').value = '';
        document.getElementById('ag-title').value = '';
        document.getElementById('ag-classic').value = '';
        document.getElementById('ag-character').value = '';
        document.getElementById('ag-mechanic').value = '';
        document.getElementById('ag-icon-color').value = '#333333';
        document.getElementById('ag-icon-emoji').value = '';
        document.getElementById('ag-sort-order').value = '100';
        document.getElementById('ag-scene-code').value = '';
        document.getElementById('ag-form-error').textContent = '';
    }

    // =========================================
    // Category Checkboxes in Game Form
    // =========================================

    function _populateCategoryCheckboxes(selectedIds) {
        const container = document.getElementById('ag-categories-checkboxes');
        if (!container) return;

        if (_categories.length === 0) {
            container.innerHTML = '<span style="color:#a0a0c0;font-size:0.8rem;">No categories yet. Create some in the Categories tab.</span>';
            return;
        }

        container.innerHTML = _categories.map(c => {
            const checked = selectedIds.includes(c.id) ? 'checked' : '';
            return `<label class="ag-cat-checkbox">
                <input type="checkbox" value="${_escapeAttr(c.id)}" ${checked}>
                <span class="ag-cat-chip" style="border-color:${_escapeAttr(c.icon_color)}">${_escapeHtml(c.icon_emoji || '')} ${_escapeHtml(c.name)}</span>
            </label>`;
        }).join('');
    }

    function _getSelectedCategoryIds() {
        const container = document.getElementById('ag-categories-checkboxes');
        if (!container) return [];
        const checkboxes = container.querySelectorAll('input[type="checkbox"]:checked');
        return Array.from(checkboxes).map(cb => cb.value);
    }

    // =========================================
    // Load & Render Games
    // =========================================

    async function _loadGames() {
        try {
            const data = await _apiRequest('GET', '');
            _games = data.games || [];
            _renderList();
        } catch (e) {
            console.warn('AdminGames: Failed to load games', e);
            document.getElementById('admin-games-table').innerHTML =
                '<p class="admin-games-empty">Failed to load games. Make sure you have admin access.</p>';
        }
    }

    function _renderList() {
        const container = document.getElementById('admin-games-table');

        if (_games.length === 0) {
            container.innerHTML = '<p class="admin-games-empty">No custom games yet. Click "Add Game" to create one.</p>';
            return;
        }

        // Build a category lookup
        const catMap = {};
        for (const c of _categories) catMap[c.id] = c;

        container.innerHTML = `
            <div class="ag-table-header">
                <span class="ag-col-icon">Icon</span>
                <span class="ag-col-title">Title</span>
                <span class="ag-col-category">Category</span>
                <span class="ag-col-status">Status</span>
                <span class="ag-col-actions">Actions</span>
            </div>
            ${_games.map(g => {
                const gameCats = Array.isArray(g.categories) ? g.categories : [];
                const catBadges = gameCats.map(cid => {
                    const c = catMap[cid];
                    return c ? `<span class="ag-cat-badge" style="border-color:${_escapeAttr(c.icon_color)}">${_escapeHtml(c.icon_emoji || '')} ${_escapeHtml(c.name)}</span>` : '';
                }).filter(Boolean).join(' ') || '<span style="color:#666;font-size:0.75rem;">None</span>';

                return `
                <div class="ag-table-row ${g.is_active ? '' : 'ag-row-inactive'}">
                    <span class="ag-col-icon">
                        <span class="ag-icon-preview" style="background:${_escapeAttr(g.icon_color)}">${_escapeHtml(g.icon_emoji || '?')}</span>
                    </span>
                    <span class="ag-col-title">${_escapeHtml(g.title)}</span>
                    <span class="ag-col-category">${catBadges}</span>
                    <span class="ag-col-status">
                        <span class="ag-status-badge ${g.is_active ? 'ag-active' : 'ag-inactive'}">${g.is_active ? 'Active' : 'Inactive'}</span>
                    </span>
                    <span class="ag-col-actions">
                        <button class="btn-outline btn-sm" onclick="AdminGames.showEditForm('${_escapeAttr(g.id)}')">Edit</button>
                        <button class="btn-outline btn-sm" onclick="AdminGames.toggleGame('${_escapeAttr(g.id)}')">${g.is_active ? 'Disable' : 'Enable'}</button>
                        <button class="btn-outline btn-sm btn-danger" onclick="AdminGames.deleteGame('${_escapeAttr(g.id)}')">Delete</button>
                    </span>
                </div>`;
            }).join('')}
        `;
    }

    // =========================================
    // Load & Render Categories
    // =========================================

    async function _loadCategories() {
        try {
            const data = await _apiRequest('GET', '/categories/all');
            _categories = data.categories || [];
        } catch (e) {
            // Fallback to public endpoint
            try {
                const res = await fetch(API_PUBLIC + '/categories');
                if (res.ok) {
                    const data = await res.json();
                    _categories = data.categories || [];
                }
            } catch (_) {
                _categories = [];
            }
        }
    }

    function _renderCategories() {
        const container = document.getElementById('admin-categories-table');
        if (!container) return;

        if (_categories.length === 0) {
            container.innerHTML = '<p class="admin-games-empty">No categories yet. Click "Add Category" to create one.</p>';
            return;
        }

        container.innerHTML = `
            <div class="ag-table-header ag-cat-table-header">
                <span class="ag-col-icon">Icon</span>
                <span class="ag-col-title">Name</span>
                <span class="ag-col-id">Slug</span>
                <span class="ag-col-status">Games</span>
                <span class="ag-col-actions">Actions</span>
            </div>
            ${_categories.map(c => `
                <div class="ag-table-row">
                    <span class="ag-col-icon">
                        <span class="ag-icon-preview" style="background:${_escapeAttr(c.icon_color)}">${_escapeHtml(c.icon_emoji || '')}</span>
                    </span>
                    <span class="ag-col-title">${_escapeHtml(c.name)}</span>
                    <span class="ag-col-id">${_escapeHtml(c.slug || c.id)}</span>
                    <span class="ag-col-status">
                        <span class="ag-status-badge ag-active">${c.game_count || 0}</span>
                    </span>
                    <span class="ag-col-actions">
                        <button class="btn-outline btn-sm" onclick="AdminGames.editCategory('${_escapeAttr(c.id)}')">Edit</button>
                        <button class="btn-outline btn-sm btn-danger" onclick="AdminGames.deleteCategory('${_escapeAttr(c.id)}')">Delete</button>
                    </span>
                </div>
            `).join('')}
        `;
    }

    // =========================================
    // Category CRUD
    // =========================================

    function showAddCategory() {
        const name = prompt('Category name:');
        if (!name || !name.trim()) return;

        const emoji = prompt('Icon emoji (e.g. ⚛️):', '📁');
        const color = prompt('Icon color (hex):', '#667eea');

        _apiRequest('POST', '/categories', {
            name: name.trim(),
            iconEmoji: emoji || '📁',
            iconColor: color || '#667eea',
            sortOrder: (_categories.length + 1) * 10
        }).then(async () => {
            await _loadCategories();
            _renderCategories();
        }).catch(e => alert(e.message || 'Failed to create category'));
    }

    function editCategory(categoryId) {
        const cat = _categories.find(c => c.id === categoryId);
        if (!cat) return;

        const name = prompt('Category name:', cat.name);
        if (!name || !name.trim()) return;

        const emoji = prompt('Icon emoji:', cat.icon_emoji || '📁');
        const color = prompt('Icon color (hex):', cat.icon_color || '#667eea');
        const sortOrder = prompt('Sort order:', cat.sort_order || 100);

        _apiRequest('PUT', '/categories/' + categoryId, {
            name: name.trim(),
            description: cat.description || '',
            iconEmoji: emoji || '📁',
            iconColor: color || '#667eea',
            sortOrder: parseInt(sortOrder, 10) || 100,
            isActive: cat.is_active !== false
        }).then(async () => {
            await _loadCategories();
            _renderCategories();
        }).catch(e => alert(e.message || 'Failed to update category'));
    }

    async function deleteCategory(categoryId) {
        if (!confirm('Delete this category? Games will be uncategorized but not deleted.')) return;
        try {
            await _apiRequest('DELETE', '/categories/' + categoryId);
            await _loadCategories();
            _renderCategories();
        } catch (e) {
            alert(e.message || 'Failed to delete category');
        }
    }

    // =========================================
    // Assign Categories to Built-in Games
    // =========================================

    async function showAssignBuiltIn() {
        // This allows admins to assign categories to the 25 built-in games
        const gameId = prompt('Enter Game ID (e.g. PhysicsMasterBilliards):');
        if (!gameId || !gameId.trim()) return;

        if (_categories.length === 0) {
            alert('Create categories first.');
            return;
        }

        const catNames = _categories.map(c => `${c.icon_emoji} ${c.name} (${c.id})`).join('\n');
        const input = prompt(`Available categories:\n${catNames}\n\nEnter category IDs (comma-separated):`);
        if (!input) return;

        const categoryIds = input.split(',').map(s => s.trim()).filter(Boolean);

        try {
            await _apiRequest('PUT', '/' + gameId.trim() + '/categories', { categoryIds });
            alert('Categories assigned to ' + gameId);
            await _loadCategories();
            _renderCategories();
        } catch (e) {
            alert(e.message || 'Failed to assign categories');
        }
    }

    // =========================================
    // Form Submit (Games)
    // =========================================

    async function handleSubmit(event) {
        event.preventDefault();
        const errEl = document.getElementById('ag-form-error');
        errEl.textContent = '';

        const gameData = {
            id: document.getElementById('ag-id').value.trim(),
            title: document.getElementById('ag-title').value.trim(),
            classic: document.getElementById('ag-classic').value.trim(),
            characterId: document.getElementById('ag-character').value.trim(),
            mechanic: document.getElementById('ag-mechanic').value.trim(),
            iconColor: document.getElementById('ag-icon-color').value,
            iconEmoji: document.getElementById('ag-icon-emoji').value.trim(),
            sortOrder: parseInt(document.getElementById('ag-sort-order').value, 10) || 100,
            sceneCode: document.getElementById('ag-scene-code').value,
            categoryIds: _getSelectedCategoryIds()
        };

        if (!gameData.id || !gameData.title || !gameData.sceneCode) {
            errEl.textContent = 'Game ID, Title, and Scene Code are required.';
            return;
        }

        try {
            if (_editingId) {
                await _apiRequest('PUT', '/' + _editingId, gameData);
            } else {
                await _apiRequest('POST', '', gameData);
            }
            _showListView();
            await Promise.all([_loadGames(), _loadCategories()]);
        } catch (e) {
            errEl.textContent = e.message || 'Failed to save game';
        }
    }

    // =========================================
    // Toggle / Delete Games
    // =========================================

    async function toggleGame(gameId) {
        try {
            await _apiRequest('POST', '/' + gameId + '/toggle');
            await _loadGames();
        } catch (e) {
            alert(e.message || 'Failed to toggle game');
        }
    }

    async function deleteGame(gameId) {
        if (!confirm('Permanently delete this game? This cannot be undone.')) return;
        try {
            await _apiRequest('DELETE', '/' + gameId);
            await _loadGames();
        } catch (e) {
            alert(e.message || 'Failed to delete game');
        }
    }

    // =========================================
    // Helpers
    // =========================================

    function _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    function _escapeAttr(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    async function _apiRequest(method, path, body) {
        const headers = { 'Content-Type': 'application/json' };
        const token = localStorage.getItem('stem_auth_token');
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const opts = { method, headers };
        if (body && method !== 'GET') opts.body = JSON.stringify(body);

        const res = await fetch(API_BASE + path, opts);
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Request failed');
        }
        return res.json();
    }

    return {
        show,
        showAddForm,
        showEditForm,
        showCategoriesView,
        showAddCategory,
        editCategory,
        deleteCategory,
        showAssignBuiltIn,
        handleSubmit,
        toggleGame,
        deleteGame,
        backToList: _showListView
    };
})();
