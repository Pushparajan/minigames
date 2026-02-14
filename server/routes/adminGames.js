/**
 * Admin Game Management Routes
 * ==============================
 * CRUD endpoints for managing custom games.
 * Admins can add, edit, toggle, and delete games via the UI.
 *
 * Routes:
 *   GET    /admin/games           — List all custom games
 *   POST   /admin/games           — Create a new custom game
 *   PUT    /admin/games/:id       — Update a custom game
 *   DELETE /admin/games/:id       — Delete a custom game
 *   POST   /admin/games/:id/toggle — Toggle active state
 *
 * Public:
 *   GET    /games/custom          — List active custom games (for client)
 */

const express = require('express');
const db = require('../models/db');
const { requireAdmin } = require('../middleware/admin');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// =========================================
// Public: Fetch active custom games
// =========================================

router.get('/custom', async (req, res, next) => {
    try {
        const tenantId = req.tenantId || 'stem_default';

        const result = await db.query(`
            SELECT id, title, classic, character_id, mechanic,
                   icon_color, icon_emoji, scene_code, sort_order
            FROM custom_games
            WHERE tenant_id = $1 AND is_active = TRUE
            ORDER BY sort_order ASC, created_at ASC
        `, [tenantId]);

        res.json({ games: result.rows });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Admin: List all custom games
// =========================================

router.get('/', authenticate, requireAdmin('admin'), async (req, res, next) => {
    try {
        const tenantId = req.player.tenantId;

        const result = await db.query(`
            SELECT cg.*, p.display_name as created_by_name
            FROM custom_games cg
            LEFT JOIN players p ON p.id = cg.created_by AND p.tenant_id = cg.tenant_id
            WHERE cg.tenant_id = $1
            ORDER BY cg.sort_order ASC, cg.created_at ASC
        `, [tenantId]);

        res.json({ games: result.rows });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Admin: Create a custom game
// =========================================

router.post('/', authenticate, requireAdmin('admin'), async (req, res, next) => {
    try {
        const tenantId = req.player.tenantId;
        const adminId = req.player.id;
        const { id, title, classic, characterId, mechanic, iconColor, iconEmoji, sceneCode, sortOrder } = req.body;

        if (!id || !title || !sceneCode) {
            return res.status(400).json({ error: 'id, title, and sceneCode are required' });
        }

        // Validate ID format (alphanumeric + hyphens)
        if (!/^[a-zA-Z][a-zA-Z0-9_-]{1,60}$/.test(id)) {
            return res.status(400).json({ error: 'ID must start with a letter, contain only letters, numbers, hyphens, underscores, and be 2-61 chars' });
        }

        // Check for duplicate ID
        const existing = await db.query(
            'SELECT id FROM custom_games WHERE id = $1 AND tenant_id = $2',
            [id, tenantId]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'A game with this ID already exists' });
        }

        const result = await db.query(`
            INSERT INTO custom_games (id, tenant_id, title, classic, character_id, mechanic, icon_color, icon_emoji, scene_code, sort_order, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `, [id, tenantId, title, classic || null, characterId || null, mechanic || null,
            iconColor || '#333', iconEmoji || '?', sceneCode, sortOrder || 100, adminId]);

        res.status(201).json({ game: result.rows[0] });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Admin: Update a custom game
// =========================================

router.put('/:id', authenticate, requireAdmin('admin'), async (req, res, next) => {
    try {
        const tenantId = req.player.tenantId;
        const gameId = req.params.id;
        const { title, classic, characterId, mechanic, iconColor, iconEmoji, sceneCode, sortOrder } = req.body;

        if (!title || !sceneCode) {
            return res.status(400).json({ error: 'title and sceneCode are required' });
        }

        const result = await db.query(`
            UPDATE custom_games
            SET title = $1, classic = $2, character_id = $3, mechanic = $4,
                icon_color = $5, icon_emoji = $6, scene_code = $7, sort_order = $8,
                updated_at = NOW()
            WHERE id = $9 AND tenant_id = $10
            RETURNING *
        `, [title, classic || null, characterId || null, mechanic || null,
            iconColor || '#333', iconEmoji || '?', sceneCode, sortOrder || 100,
            gameId, tenantId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Game not found' });
        }

        res.json({ game: result.rows[0] });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Admin: Toggle active state
// =========================================

router.post('/:id/toggle', authenticate, requireAdmin('admin'), async (req, res, next) => {
    try {
        const tenantId = req.player.tenantId;
        const gameId = req.params.id;

        const result = await db.query(`
            UPDATE custom_games
            SET is_active = NOT is_active, updated_at = NOW()
            WHERE id = $1 AND tenant_id = $2
            RETURNING id, is_active
        `, [gameId, tenantId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Game not found' });
        }

        res.json({ game: result.rows[0] });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Admin: Delete a custom game
// =========================================

router.delete('/:id', authenticate, requireAdmin('admin'), async (req, res, next) => {
    try {
        const tenantId = req.player.tenantId;
        const gameId = req.params.id;

        const result = await db.query(
            'DELETE FROM custom_games WHERE id = $1 AND tenant_id = $2 RETURNING id',
            [gameId, tenantId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Game not found' });
        }

        res.json({ message: 'Game deleted' });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
