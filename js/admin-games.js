/**
 * AdminGames.js
 * ===============
 * Admin panel for managing custom games.
 * Allows admins to add, edit, toggle, and delete games
 * through a modal interface.
 */

const AdminGames = (() => {
    'use strict';

    const API_BASE = '/api/v1/admin/games';
    let _games = [];
    let _editingId = null;

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
        await _loadGames();
    }

    // =========================================
    // Views
    // =========================================

    function _showListView() {
        document.getElementById('admin-games-list').style.display = 'block';
        document.getElementById('admin-games-form').style.display = 'none';
        _editingId = null;
    }

    function showAddForm() {
        _editingId = null;
        document.getElementById('admin-games-list').style.display = 'none';
        document.getElementById('admin-games-form').style.display = 'block';
        document.getElementById('admin-games-form-title').textContent = 'Add New Game';
        _clearForm();
        document.getElementById('ag-id').disabled = false;
    }

    function showEditForm(gameId) {
        const game = _games.find(g => g.id === gameId);
        if (!game) return;

        _editingId = gameId;
        document.getElementById('admin-games-list').style.display = 'none';
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
    // Load & Render
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

        container.innerHTML = `
            <div class="ag-table-header">
                <span class="ag-col-icon">Icon</span>
                <span class="ag-col-title">Title</span>
                <span class="ag-col-id">ID</span>
                <span class="ag-col-status">Status</span>
                <span class="ag-col-actions">Actions</span>
            </div>
            ${_games.map(g => `
                <div class="ag-table-row ${g.is_active ? '' : 'ag-row-inactive'}">
                    <span class="ag-col-icon">
                        <span class="ag-icon-preview" style="background:${_escapeAttr(g.icon_color)}">${_escapeHtml(g.icon_emoji || '?')}</span>
                    </span>
                    <span class="ag-col-title">${_escapeHtml(g.title)}</span>
                    <span class="ag-col-id">${_escapeHtml(g.id)}</span>
                    <span class="ag-col-status">
                        <span class="ag-status-badge ${g.is_active ? 'ag-active' : 'ag-inactive'}">${g.is_active ? 'Active' : 'Inactive'}</span>
                    </span>
                    <span class="ag-col-actions">
                        <button class="btn-outline btn-sm" onclick="AdminGames.showEditForm('${_escapeAttr(g.id)}')">Edit</button>
                        <button class="btn-outline btn-sm" onclick="AdminGames.toggleGame('${_escapeAttr(g.id)}')">${g.is_active ? 'Disable' : 'Enable'}</button>
                        <button class="btn-outline btn-sm btn-danger" onclick="AdminGames.deleteGame('${_escapeAttr(g.id)}')">Delete</button>
                    </span>
                </div>
            `).join('')}
        `;
    }

    // =========================================
    // Form Submit
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
            sceneCode: document.getElementById('ag-scene-code').value
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
            await _loadGames();
        } catch (e) {
            errEl.textContent = e.message || 'Failed to save game';
        }
    }

    // =========================================
    // Toggle / Delete
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
        handleSubmit,
        toggleGame,
        deleteGame,
        backToList: _showListView
    };
})();
