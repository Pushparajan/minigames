/**
 * STEM Adventures Admin Console
 * ================================
 * Single-page admin UI for content moderation, user management,
 * and dashboard statistics.
 */

(function () {
    'use strict';

    const API_BASE = '/api/v1';
    let authToken = localStorage.getItem('admin_token') || '';
    let currentPage = 'login';
    let logOffset = 0;

    // =========================================
    // API Helper
    // =========================================

    async function api(method, path, body) {
        const opts = {
            method,
            headers: { 'Content-Type': 'application/json' }
        };
        if (authToken) opts.headers['Authorization'] = `Bearer ${authToken}`;
        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(`${API_BASE}${path}`, opts);
        const data = await res.json();
        if (!res.ok) {
            if (res.status === 401) { showPage('login'); throw new Error('Session expired'); }
            throw new Error(data.error || 'API error');
        }
        return data;
    }

    // =========================================
    // Navigation
    // =========================================

    function showPage(page) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const el = document.getElementById(`page-${page}`);
        if (el) el.classList.add('active');
        document.querySelectorAll('.nav-link').forEach(l => {
            l.classList.toggle('active', l.dataset.page === page);
        });
        currentPage = page;

        if (page === 'dashboard') loadDashboard();
        if (page === 'queue') loadQueue();
        if (page === 'reports') loadReports();
        if (page === 'log') { logOffset = 0; loadLog(); }
    }

    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            if (!authToken) return;
            showPage(link.dataset.page);
        });
    });

    // =========================================
    // Login
    // =========================================

    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const errorEl = document.getElementById('login-error');

        try {
            errorEl.textContent = '';
            const data = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            }).then(r => r.json());

            if (data.error) throw new Error(data.error);

            authToken = data.accessToken;
            localStorage.setItem('admin_token', authToken);

            // Verify admin access
            await api('GET', '/admin/stats');
            document.getElementById('admin-name').textContent = email.split('@')[0];
            showPage('dashboard');
        } catch (err) {
            errorEl.textContent = err.message || 'Login failed';
        }
    });

    document.getElementById('btn-logout').addEventListener('click', () => {
        authToken = '';
        localStorage.removeItem('admin_token');
        showPage('login');
    });

    // =========================================
    // Dashboard
    // =========================================

    async function loadDashboard() {
        try {
            const data = await api('GET', '/admin/stats');
            document.getElementById('stat-pending-comments').textContent = (data.comments.pending || 0) + (data.comments.hidden || 0);
            document.getElementById('stat-flagged').textContent = data.comments.flagged || 0;
            document.getElementById('stat-open-reports').textContent = data.reports.open || 0;
            document.getElementById('stat-total-players').textContent = data.players.total;
            document.getElementById('stat-new-today').textContent = data.players.newToday;
            document.getElementById('stat-new-week').textContent = data.players.newThisWeek;
        } catch (err) {
            console.error('Dashboard load failed:', err);
        }
    }

    // =========================================
    // Moderation Queue
    // =========================================

    async function loadQueue() {
        const list = document.getElementById('queue-list');
        const type = document.getElementById('queue-filter').value;
        try {
            const data = await api('GET', `/admin/queue?type=${type}`);
            if (data.queue.length === 0) {
                list.innerHTML = '<p class="empty-state">Queue is empty. All clear!</p>';
                return;
            }
            list.innerHTML = data.queue.map(item => renderQueueItem(item)).join('');
            bindQueueActions();
        } catch (err) {
            list.innerHTML = `<p class="empty-state">Error: ${err.message}</p>`;
        }
    }

    function renderQueueItem(item) {
        const typeBadge = item.type === 'comment'
            ? '<span class="badge badge-comment">Comment</span>'
            : '<span class="badge badge-review">Review</span>';
        const statusBadge = `<span class="badge badge-${item.status}">${item.status}</span>`;
        const reportBadge = parseInt(item.report_count, 10) > 0
            ? `<span class="badge badge-reports">${item.report_count} reports</span>` : '';

        return `
            <div class="content-item" data-id="${item.id}" data-type="${item.type}">
                <div class="item-header">
                    <div>${typeBadge} ${statusBadge} ${reportBadge}</div>
                    <span class="item-meta">${item.game_id} | ${new Date(item.created_at).toLocaleDateString()}</span>
                </div>
                <div class="item-meta">By: ${escHtml(item.author_name)} (${item.author_id})</div>
                ${item.title ? `<div class="item-body"><strong>${escHtml(item.title)}</strong></div>` : ''}
                <div class="item-body">${escHtml(item.body || '')}</div>
                ${item.rating ? `<div class="item-meta">Rating: ${'*'.repeat(item.rating)}</div>` : ''}
                <div class="item-actions">
                    <button class="btn btn-sm btn-success" data-action="approve">Approve</button>
                    <button class="btn btn-sm btn-warn" data-action="hide">Hide</button>
                    <button class="btn btn-sm btn-danger" data-action="remove">Remove</button>
                </div>
            </div>`;
    }

    function bindQueueActions() {
        document.querySelectorAll('#queue-list .item-actions button').forEach(btn => {
            btn.addEventListener('click', async () => {
                const item = btn.closest('.content-item');
                const id = item.dataset.id;
                const type = item.dataset.type;
                const action = btn.dataset.action;
                const endpoint = type === 'comment' ? 'comments' : 'reviews';

                showModal(`${action} this ${type}?`, async (reason) => {
                    try {
                        await api('POST', `/admin/${endpoint}/${id}/${action}`, { reason });
                        item.remove();
                    } catch (err) {
                        alert(err.message);
                    }
                });
            });
        });
    }

    document.getElementById('queue-filter').addEventListener('change', loadQueue);
    document.getElementById('btn-refresh-queue').addEventListener('click', loadQueue);

    // =========================================
    // Reports
    // =========================================

    async function loadReports() {
        const list = document.getElementById('reports-list');
        const status = document.getElementById('report-status-filter').value;
        try {
            const data = await api('GET', `/admin/reports?status=${status}`);
            if (data.reports.length === 0) {
                list.innerHTML = '<p class="empty-state">No reports found.</p>';
                return;
            }
            list.innerHTML = data.reports.map(renderReport).join('');
            bindReportActions();
        } catch (err) {
            list.innerHTML = `<p class="empty-state">Error: ${err.message}</p>`;
        }
    }

    function renderReport(r) {
        const statusBadge = `<span class="badge badge-${r.status}">${r.status}</span>`;
        return `
            <div class="content-item" data-id="${r.id}">
                <div class="item-header">
                    <div>${statusBadge} <span class="badge badge-${r.content_type}">${r.content_type}</span></div>
                    <span class="item-meta">${new Date(r.created_at).toLocaleDateString()}</span>
                </div>
                <div class="item-meta">Reported by: ${escHtml(r.reporter_name)} | Reason: ${r.reason}</div>
                ${r.description ? `<div class="item-body">${escHtml(r.description)}</div>` : ''}
                <div class="item-meta">Content ID: ${r.content_id}</div>
                ${r.status === 'open' ? `
                <div class="item-actions">
                    <button class="btn btn-sm btn-success" data-action="resolve" data-resolve-action="hide_content">Resolve (Hide)</button>
                    <button class="btn btn-sm btn-danger" data-action="resolve" data-resolve-action="remove_content">Resolve (Remove)</button>
                    <button class="btn btn-sm btn-secondary" data-action="dismiss">Dismiss</button>
                </div>` : ''}
            </div>`;
    }

    function bindReportActions() {
        document.querySelectorAll('#reports-list .item-actions button').forEach(btn => {
            btn.addEventListener('click', async () => {
                const item = btn.closest('.content-item');
                const id = item.dataset.id;
                const actionType = btn.dataset.action;

                showModal(`${actionType} this report?`, async (note) => {
                    try {
                        if (actionType === 'resolve') {
                            await api('POST', `/admin/reports/${id}/resolve`, {
                                note,
                                action: btn.dataset.resolveAction
                            });
                        } else {
                            await api('POST', `/admin/reports/${id}/dismiss`, { note });
                        }
                        item.remove();
                    } catch (err) {
                        alert(err.message);
                    }
                });
            });
        });
    }

    document.getElementById('report-status-filter').addEventListener('change', loadReports);
    document.getElementById('btn-refresh-reports').addEventListener('click', loadReports);

    // =========================================
    // Users
    // =========================================

    async function searchUsers() {
        const list = document.getElementById('users-list');
        const search = document.getElementById('user-search').value;
        try {
            const data = await api('GET', `/admin/users?search=${encodeURIComponent(search)}`);
            if (data.users.length === 0) {
                list.innerHTML = '<p class="empty-state">No users found.</p>';
                return;
            }
            list.innerHTML = data.users.map(renderUser).join('');
            bindUserActions();
        } catch (err) {
            list.innerHTML = `<p class="empty-state">Error: ${err.message}</p>`;
        }
    }

    function renderUser(u) {
        const roleBadge = u.admin_role ? `<span class="badge badge-role">${u.admin_role}</span>` : '';
        return `
            <div class="content-item" data-id="${u.id}">
                <div class="item-header">
                    <div>
                        <strong>${escHtml(u.display_name)}</strong> ${roleBadge}
                        ${u.is_guest ? '<span class="badge badge-hidden">guest</span>' : ''}
                    </div>
                    <span class="item-meta">Joined ${new Date(u.created_at).toLocaleDateString()}</span>
                </div>
                <div class="item-meta">${escHtml(u.email || 'No email')} | Score: ${u.total_score} | Games: ${u.games_played}</div>
                <div class="item-actions">
                    <button class="btn btn-sm btn-primary" data-action="detail">Details</button>
                    <button class="btn btn-sm btn-warn" data-action="warn">Warn</button>
                    <button class="btn btn-sm btn-danger" data-action="ban">Ban</button>
                </div>
            </div>`;
    }

    function bindUserActions() {
        document.querySelectorAll('#users-list .item-actions button').forEach(btn => {
            btn.addEventListener('click', async () => {
                const item = btn.closest('.content-item');
                const id = item.dataset.id;
                const action = btn.dataset.action;

                if (action === 'detail') {
                    await loadUserDetail(id);
                } else {
                    showModal(`${action} this user?`, async (reason) => {
                        try {
                            await api('POST', `/admin/users/${id}/${action}`, { reason });
                            alert(`User ${action}ned`);
                        } catch (err) {
                            alert(err.message);
                        }
                    });
                }
            });
        });
    }

    async function loadUserDetail(userId) {
        const panel = document.getElementById('user-detail');
        const content = document.getElementById('user-detail-content');
        try {
            const data = await api('GET', `/admin/users/${userId}`);
            const u = data.user;
            content.innerHTML = `
                <h2>${escHtml(u.display_name)}</h2>
                <div class="detail-section">
                    <h3>Profile</h3>
                    <p>ID: ${u.id}</p>
                    <p>Email: ${escHtml(u.email || 'N/A')}</p>
                    <p>Avatar: ${u.avatar_character}</p>
                    <p>Role: ${u.admin_role || 'Player'}</p>
                    <p>Joined: ${new Date(u.created_at).toLocaleString()}</p>
                    <p>Last Login: ${new Date(u.last_login_at).toLocaleString()}</p>
                </div>
                <div class="detail-section">
                    <h3>Activity</h3>
                    <p>Total Score: ${u.total_score}</p>
                    <p>Games Played: ${u.games_played}</p>
                    <p>Comments: ${data.stats.comments}</p>
                    <p>Reviews: ${data.stats.reviews}</p>
                    <p>Reports Against: ${data.stats.reportsAgainst}</p>
                </div>
                <div class="detail-section">
                    <h3>Moderation History</h3>
                    ${data.moderationHistory.length === 0 ? '<p class="item-meta">No moderation history</p>' :
                        data.moderationHistory.map(m => `
                            <div class="item-meta" style="margin-bottom:6px;">
                                ${m.action} — ${m.reason || 'No reason'} (${new Date(m.created_at).toLocaleDateString()})
                            </div>
                        `).join('')}
                </div>`;
            panel.style.display = 'block';
        } catch (err) {
            content.innerHTML = `<p class="error-msg">${err.message}</p>`;
            panel.style.display = 'block';
        }
    }

    document.getElementById('btn-search-users').addEventListener('click', searchUsers);
    document.getElementById('user-search').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchUsers();
    });
    document.getElementById('btn-close-detail').addEventListener('click', () => {
        document.getElementById('user-detail').style.display = 'none';
    });

    // =========================================
    // Audit Log
    // =========================================

    async function loadLog(append) {
        const list = document.getElementById('log-list');
        try {
            const data = await api('GET', `/admin/log?limit=50&offset=${logOffset}`);
            const html = data.log.map(renderLogEntry).join('');
            if (append) {
                list.insertAdjacentHTML('beforeend', html);
            } else {
                list.innerHTML = html || '<p class="empty-state">No log entries.</p>';
            }
        } catch (err) {
            if (!append) list.innerHTML = `<p class="empty-state">Error: ${err.message}</p>`;
        }
    }

    function renderLogEntry(entry) {
        return `
            <div class="content-item">
                <div class="item-header">
                    <div><strong>${entry.action}</strong> on ${entry.content_type || 'N/A'}</div>
                    <span class="item-meta">${new Date(entry.created_at).toLocaleString()}</span>
                </div>
                <div class="item-meta">Admin: ${escHtml(entry.admin_name)} | Target: ${entry.target_player_id || entry.content_id || 'N/A'}</div>
                ${entry.reason ? `<div class="item-body">${escHtml(entry.reason)}</div>` : ''}
            </div>`;
    }

    document.getElementById('btn-load-more-log').addEventListener('click', () => {
        logOffset += 50;
        loadLog(true);
    });

    // =========================================
    // Modal
    // =========================================

    let _modalCallback = null;

    function showModal(title, callback) {
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-reason').value = '';
        document.getElementById('action-modal').style.display = 'flex';
        _modalCallback = callback;
    }

    document.getElementById('modal-confirm').addEventListener('click', async () => {
        const reason = document.getElementById('modal-reason').value;
        document.getElementById('action-modal').style.display = 'none';
        if (_modalCallback) await _modalCallback(reason);
        _modalCallback = null;
    });

    document.getElementById('modal-cancel').addEventListener('click', () => {
        document.getElementById('action-modal').style.display = 'none';
        _modalCallback = null;
    });

    // =========================================
    // Helpers
    // =========================================

    function escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // =========================================
    // Init
    // =========================================

    if (authToken) {
        api('GET', '/admin/stats')
            .then(() => showPage('dashboard'))
            .catch(() => {
                authToken = '';
                localStorage.removeItem('admin_token');
                showPage('login');
            });
    } else {
        showPage('login');
    }
})();
