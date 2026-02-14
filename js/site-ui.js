/**
 * SiteUI.js
 * ==========
 * Handles user authentication, billing/subscription management,
 * and modal UI for the STEM School Adventures website.
 * Integrates with CloudSyncAPI for auth and the billing API.
 */

const SiteUI = (() => {
    'use strict';

    const API_BASE = '/api/v1';
    let _token = null;
    let _refreshToken = null;
    let _user = null;
    let _orgId = null;

    // =========================================
    // Initialization
    // =========================================

    function init() {
        // Restore session from localStorage
        _token = localStorage.getItem('stem_auth_token');
        _refreshToken = localStorage.getItem('stem_refresh_token');
        const savedUser = localStorage.getItem('stem_user');
        if (savedUser) {
            try { _user = JSON.parse(savedUser); } catch (e) { _user = null; }
        }
        _orgId = localStorage.getItem('stem_org_id');

        _updateNavState();
    }

    // =========================================
    // Navigation State
    // =========================================

    function _updateNavState() {
        const guestNav = document.getElementById('nav-guest');
        const userNav = document.getElementById('nav-user');
        const username = document.getElementById('nav-username');

        if (_token && _user) {
            guestNav.style.display = 'none';
            userNav.style.display = 'flex';
            username.textContent = _user.displayName || _user.email || 'Player';
        } else {
            guestNav.style.display = 'flex';
            userNav.style.display = 'none';
        }
    }

    // =========================================
    // Modal Management
    // =========================================

    function _showModal(modalId) {
        const overlay = document.getElementById('modal-overlay');
        // Hide all modals first
        overlay.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
        overlay.style.display = 'flex';
        document.getElementById(modalId).style.display = 'block';
    }

    function closeModal(event) {
        if (event && event.target !== event.currentTarget && !event.target.classList.contains('modal-close')) return;
        document.getElementById('modal-overlay').style.display = 'none';
        document.getElementById('modal-overlay').querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    }

    function showLogin() { _showModal('modal-login'); }
    function showRegister() { _showModal('modal-register'); }
    function showPlans() { _showModal('modal-plans'); }

    // =========================================
    // Auth: Register
    // =========================================

    async function handleRegister(event) {
        event.preventDefault();
        const errEl = document.getElementById('reg-error');
        errEl.textContent = '';

        const displayName = document.getElementById('reg-name').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;

        try {
            const res = await _apiRequest('POST', '/auth/register', {
                email,
                password,
                displayName,
                playerId: SaveManager.getPlayer().playerId,
                avatarCharacter: SaveManager.getPlayer().avatarCharacter
            });

            if (res.token) {
                _token = res.token;
                _refreshToken = res.refreshToken;
                _user = { email, displayName, id: res.playerId || res.id };
                _saveSession();
                SaveManager.setAuthToken(res.token);
                _updateNavState();
                closeModal();
            }
        } catch (err) {
            errEl.textContent = err.message || 'Registration failed';
        }
    }

    // =========================================
    // Auth: Login
    // =========================================

    async function handleLogin(event) {
        event.preventDefault();
        const errEl = document.getElementById('login-error');
        errEl.textContent = '';

        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;

        try {
            const res = await _apiRequest('POST', '/auth/login', { email, password });

            if (res.token) {
                _token = res.token;
                _refreshToken = res.refreshToken;
                _user = {
                    email,
                    displayName: res.displayName || res.player?.displayName || email,
                    id: res.playerId || res.player?.id
                };
                _saveSession();
                SaveManager.setAuthToken(res.token);

                if (res.playerData) {
                    SaveManager.mergeCloudData(res.playerData);
                }

                _updateNavState();
                closeModal();
            }
        } catch (err) {
            errEl.textContent = err.message || 'Login failed';
        }
    }

    // =========================================
    // Auth: Logout
    // =========================================

    function logout() {
        _token = null;
        _refreshToken = null;
        _user = null;
        _orgId = null;
        localStorage.removeItem('stem_auth_token');
        localStorage.removeItem('stem_refresh_token');
        localStorage.removeItem('stem_user');
        localStorage.removeItem('stem_org_id');
        _updateNavState();
    }

    // =========================================
    // Billing: Show status
    // =========================================

    async function showBilling() {
        if (!_token) return showLogin();
        _showModal('modal-billing');

        document.getElementById('billing-loading').style.display = 'block';
        document.getElementById('billing-info').style.display = 'none';
        document.getElementById('billing-free').style.display = 'none';

        try {
            const status = await _apiRequest('GET', '/billing/status');

            document.getElementById('billing-loading').style.display = 'none';

            if (status.subscription) {
                const sub = status.subscription;
                document.getElementById('billing-plan').textContent = (sub.planTier || status.plan || 'free').toUpperCase();
                document.getElementById('billing-status').textContent = sub.status;

                if (sub.trialEnd) {
                    document.getElementById('billing-trial-row').style.display = 'flex';
                    document.getElementById('billing-trial-end').textContent = new Date(sub.trialEnd).toLocaleDateString();
                }
                if (sub.currentPeriodEnd) {
                    document.getElementById('billing-period-row').style.display = 'flex';
                    document.getElementById('billing-period-end').textContent = new Date(sub.currentPeriodEnd).toLocaleDateString();
                }

                _orgId = status.organisationId;
                if (_orgId) localStorage.setItem('stem_org_id', _orgId);

                document.getElementById('billing-info').style.display = 'block';
            } else {
                document.getElementById('billing-free').style.display = 'block';
            }
        } catch (err) {
            document.getElementById('billing-loading').textContent = 'Failed to load billing info.';
        }
    }

    // =========================================
    // Billing: Subscribe
    // =========================================

    async function subscribe(planTier) {
        if (!_token) return showLogin();

        try {
            // Ensure user has an organisation
            if (!_orgId) {
                const orgs = await _apiRequest('GET', '/organisations');
                if (orgs.organisations && orgs.organisations.length > 0) {
                    _orgId = orgs.organisations[0].id;
                } else {
                    const newOrg = await _apiRequest('POST', '/organisations', {
                        name: (_user.displayName || 'My') + "'s Team"
                    });
                    _orgId = newOrg.organisation?.id || newOrg.id;
                }
                if (_orgId) localStorage.setItem('stem_org_id', _orgId);
            }

            const res = await _apiRequest('POST', '/billing/subscribe', {
                organisationId: _orgId,
                planTier,
                trial: true
            });

            closeModal();
            alert('Subscribed to ' + planTier.toUpperCase() + ' plan! Your 14-day free trial has started.');
        } catch (err) {
            if (err.code === 'TRIAL_ALREADY_USED') {
                // Try without trial
                try {
                    const res = await _apiRequest('POST', '/billing/subscribe', {
                        organisationId: _orgId,
                        planTier,
                        trial: false
                    });
                    closeModal();
                    alert('Subscribed to ' + planTier.toUpperCase() + ' plan!');
                } catch (innerErr) {
                    alert(innerErr.message || 'Subscription failed');
                }
            } else {
                alert(err.message || 'Subscription failed');
            }
        }
    }

    // =========================================
    // Billing: Cancel
    // =========================================

    async function cancelSubscription() {
        if (!confirm('Cancel your subscription? It will remain active until the end of the billing period.')) return;

        try {
            await _apiRequest('POST', '/billing/cancel', {
                organisationId: _orgId,
                immediate: false
            });
            alert('Subscription will cancel at end of billing period.');
            showBilling();
        } catch (err) {
            alert(err.message || 'Cancellation failed');
        }
    }

    // =========================================
    // Billing: Stripe Portal
    // =========================================

    async function openBillingPortal() {
        try {
            const res = await _apiRequest('POST', '/billing/portal', {
                organisationId: _orgId,
                returnUrl: window.location.origin + '/billing'
            });
            if (res.url) {
                window.location.href = res.url;
            }
        } catch (err) {
            alert(err.message || 'Could not open billing portal');
        }
    }

    // =========================================
    // HTTP Client
    // =========================================

    async function _apiRequest(method, path, body) {
        const headers = { 'Content-Type': 'application/json' };
        if (_token) headers['Authorization'] = 'Bearer ' + _token;

        const opts = { method, headers };
        if (body && method !== 'GET') opts.body = JSON.stringify(body);

        const response = await fetch(API_BASE + path, opts);

        // Try token refresh on 401
        if (response.status === 401 && _refreshToken) {
            const refreshed = await _tryRefresh();
            if (refreshed) {
                headers['Authorization'] = 'Bearer ' + _token;
                const retry = await fetch(API_BASE + path, { ...opts, headers });
                if (!retry.ok) {
                    const data = await retry.json().catch(() => ({}));
                    throw { message: data.error || data.message || 'Request failed', code: data.code };
                }
                return retry.json();
            }
        }

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw { message: data.error || data.message || 'Request failed', code: data.code };
        }

        return response.json();
    }

    async function _tryRefresh() {
        try {
            const res = await fetch(API_BASE + '/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: _refreshToken })
            });
            if (!res.ok) return false;
            const data = await res.json();
            if (data.token) {
                _token = data.token;
                _refreshToken = data.refreshToken || _refreshToken;
                _saveSession();
                SaveManager.setAuthToken(_token);
                return true;
            }
        } catch (e) { /* ignore */ }
        return false;
    }

    // =========================================
    // Session Persistence
    // =========================================

    function _saveSession() {
        localStorage.setItem('stem_auth_token', _token);
        if (_refreshToken) localStorage.setItem('stem_refresh_token', _refreshToken);
        if (_user) localStorage.setItem('stem_user', JSON.stringify(_user));
    }

    // =========================================
    // Auto-init
    // =========================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        init,
        showLogin,
        showRegister,
        showPlans,
        showBilling,
        closeModal,
        handleLogin,
        handleRegister,
        logout,
        subscribe,
        cancelSubscription,
        openBillingPortal
    };
})();
