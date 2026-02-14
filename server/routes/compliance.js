/**
 * GDPR / CCPA Compliance Routes
 * ================================
 * Data privacy endpoints for regulatory compliance.
 *
 * Routes:
 *   GET    /compliance/consent          — Get consent status
 *   POST   /compliance/consent          — Record consent
 *   POST   /compliance/export           — Request data export
 *   GET    /compliance/export/:id       — Check export status
 *   POST   /compliance/delete           — Request data deletion
 *   GET    /compliance/privacy-policy   — Privacy policy metadata
 */

const express = require('express');
const db = require('../models/db');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// =========================================
// Get Consent Status
// =========================================

router.get('/consent', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;

        const result = await db.query(
            'SELECT gdpr_consent, gdpr_consent_at FROM players WHERE id = $1 AND tenant_id = $2',
            [playerId, tenantId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Player not found' });
        }

        res.json({
            consent: result.rows[0].gdpr_consent,
            consentAt: result.rows[0].gdpr_consent_at
        });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Record Consent
// =========================================

router.post('/consent', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const { consent } = req.body;

        if (typeof consent !== 'boolean') {
            return res.status(400).json({ error: 'consent must be a boolean' });
        }

        await db.query(`
            UPDATE players SET gdpr_consent = $1, gdpr_consent_at = NOW()
            WHERE id = $2 AND tenant_id = $3
        `, [consent, playerId, tenantId]);

        res.json({ message: 'Consent recorded', consent });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Request Data Export (GDPR Article 20)
// =========================================

router.post('/export', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;

        // Check for existing pending export
        const existing = await db.query(`
            SELECT id, status, created_at FROM gdpr_requests
            WHERE player_id = $1 AND tenant_id = $2 AND request_type = 'export'
                AND status IN ('pending', 'processing')
            ORDER BY created_at DESC LIMIT 1
        `, [playerId, tenantId]);

        if (existing.rows.length > 0) {
            return res.status(409).json({
                error: 'Export request already pending',
                requestId: existing.rows[0].id,
                status: existing.rows[0].status
            });
        }

        // Create export request
        const result = await db.query(`
            INSERT INTO gdpr_requests (tenant_id, player_id, request_type, status)
            VALUES ($1, $2, 'export', 'pending')
            RETURNING id, status, created_at
        `, [tenantId, playerId]);

        // Trigger async export (in production, this would be a job queue)
        _processExport(result.rows[0].id, playerId, tenantId).catch(err => {
            console.error('GDPR export failed:', err);
        });

        res.status(202).json({
            message: 'Data export request received. You will be notified when ready.',
            request: result.rows[0]
        });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Check Export Status
// =========================================

router.get('/export/:id', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const requestId = req.params.id;

        const result = await db.query(`
            SELECT id, status, download_url, completed_at, expires_at, created_at
            FROM gdpr_requests
            WHERE id = $1 AND player_id = $2 AND tenant_id = $3 AND request_type = 'export'
        `, [requestId, playerId, tenantId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Export request not found' });
        }

        res.json({ request: result.rows[0] });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Request Data Deletion (GDPR Article 17)
// =========================================

router.post('/delete', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const { confirmation } = req.body;

        if (confirmation !== 'DELETE_MY_DATA') {
            return res.status(400).json({
                error: 'Confirmation required. Send { "confirmation": "DELETE_MY_DATA" }'
            });
        }

        // Check for existing pending deletion
        const existing = await db.query(`
            SELECT id FROM gdpr_requests
            WHERE player_id = $1 AND tenant_id = $2 AND request_type = 'delete'
                AND status IN ('pending', 'processing')
        `, [playerId, tenantId]);

        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Deletion request already pending' });
        }

        // Mark player for deletion (30-day grace period)
        await db.query(`
            UPDATE players SET data_deletion_requested_at = NOW()
            WHERE id = $1 AND tenant_id = $2
        `, [playerId, tenantId]);

        // Create deletion request
        const result = await db.query(`
            INSERT INTO gdpr_requests (tenant_id, player_id, request_type, status)
            VALUES ($1, $2, 'delete', 'pending')
            RETURNING id, status, created_at
        `, [tenantId, playerId]);

        res.status(202).json({
            message: 'Data deletion request received. Your data will be deleted within 30 days. You can cancel by contacting support.',
            request: result.rows[0]
        });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Privacy Policy Metadata
// =========================================

router.get('/privacy-policy', (req, res) => {
    res.json({
        version: '1.0',
        lastUpdated: '2026-01-01',
        dataCollected: [
            { category: 'Account', items: ['email', 'display name', 'avatar'] },
            { category: 'Gameplay', items: ['scores', 'progress', 'match history'] },
            { category: 'Social', items: ['friend list', 'chat messages (in-game only)'] },
            { category: 'Technical', items: ['IP address (for matchmaking)', 'device type', 'connection quality'] }
        ],
        dataRetention: {
            accountData: 'Until account deletion',
            gameplayData: 'Until account deletion',
            chatMessages: '30 days',
            serverLogs: '90 days',
            anonymizedAnalytics: 'Indefinite'
        },
        thirdParties: [
            { name: 'Stripe', purpose: 'Payment processing' },
            { name: 'Google', purpose: 'SSO Authentication (if used)' },
            { name: 'Apple', purpose: 'SSO Authentication (if used)' }
        ],
        rights: [
            'Right to access your data (data export)',
            'Right to rectification (update profile)',
            'Right to erasure (delete account)',
            'Right to data portability (JSON export)',
            'Right to object to processing'
        ],
        contactEmail: 'privacy@minigames.cool'
    });
});

// =========================================
// Process Data Export (async)
// =========================================

async function _processExport(requestId, playerId, tenantId) {
    try {
        await db.query(
            "UPDATE gdpr_requests SET status = 'processing' WHERE id = $1",
            [requestId]
        );

        // Collect all player data
        const [profile, gameProgress, scores, matches, friends, transactions, inventory] = await Promise.all([
            db.query('SELECT id, display_name, email, avatar_character, region, locale, created_at FROM players WHERE id = $1 AND tenant_id = $2', [playerId, tenantId]),
            db.query('SELECT game_id, high_score, stars, level, play_count, updated_at FROM game_progress WHERE player_id = $1 AND tenant_id = $2', [playerId, tenantId]),
            db.query('SELECT game_id, score, created_at FROM score_history WHERE player_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 1000', [playerId, tenantId]),
            db.query('SELECT match_id, player_index, score, is_winner, placement, created_at FROM multiplayer_match_players WHERE player_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 500', [playerId, tenantId]),
            db.query(`SELECT p.display_name, f.status, f.created_at FROM friendships f JOIN players p ON (CASE WHEN f.player_id = $1 THEN p.id = f.friend_id ELSE p.id = f.player_id END) WHERE f.tenant_id = $2 AND (f.player_id = $1 OR f.friend_id = $1)`, [playerId, tenantId]),
            db.query('SELECT currency_type, amount, tx_type, source, created_at FROM economy_transactions WHERE player_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 500', [playerId, tenantId]),
            db.query('SELECT si.name, si.item_type, pi.acquired_at, pi.source FROM player_inventory pi JOIN store_items si ON si.id = pi.item_id WHERE pi.player_id = $1 AND pi.tenant_id = $2', [playerId, tenantId])
        ]);

        const exportData = {
            exportedAt: new Date().toISOString(),
            profile: profile.rows[0] || {},
            gameProgress: gameProgress.rows,
            scoreHistory: scores.rows,
            multiplayerMatches: matches.rows,
            friends: friends.rows,
            transactions: transactions.rows,
            inventory: inventory.rows
        };

        // In production: upload to S3/GCS and return a signed URL
        // For now: store as JSON reference
        const downloadUrl = `/api/v1/compliance/export/${requestId}/download`;

        await db.query(`
            UPDATE gdpr_requests
            SET status = 'completed', download_url = $1, completed_at = NOW(),
                expires_at = NOW() + INTERVAL '7 days'
            WHERE id = $2
        `, [downloadUrl, requestId]);

    } catch (err) {
        await db.query(
            "UPDATE gdpr_requests SET status = 'failed' WHERE id = $1",
            [requestId]
        );
        throw err;
    }
}

module.exports = router;
