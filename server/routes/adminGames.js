/**
 * Admin Game Management Routes
 * ==============================
 * CRUD endpoints for managing custom games and game categories.
 *
 * Routes:
 *   GET    /admin/games                   — List all custom games
 *   POST   /admin/games                   — Create a new custom game
 *   PUT    /admin/games/:id               — Update a custom game
 *   DELETE /admin/games/:id               — Delete a custom game
 *   POST   /admin/games/:id/toggle        — Toggle active state
 *   GET    /admin/games/categories         — List all categories (admin)
 *   POST   /admin/games/categories         — Create a category
 *   PUT    /admin/games/categories/:id     — Update a category
 *   DELETE /admin/games/categories/:id     — Delete a category
 *   PUT    /admin/games/:id/categories     — Assign categories to a game
 *
 * Public:
 *   GET    /games/custom                  — List active custom games (for client)
 *   GET    /games/categories              — List active categories with game assignments
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
            SELECT cg.id, cg.title, cg.classic, cg.character_id, cg.mechanic,
                   cg.icon_color, cg.icon_emoji, cg.scene_code, cg.sort_order, cg.category_id,
                   COALESCE(
                       (SELECT json_agg(gca.category_id)
                        FROM game_category_assignments gca
                        WHERE gca.game_id = cg.id AND gca.tenant_id = cg.tenant_id),
                       '[]'::json
                   ) as categories
            FROM custom_games cg
            WHERE cg.tenant_id = $1 AND cg.is_active = TRUE
            ORDER BY cg.sort_order ASC, cg.created_at ASC
        `, [tenantId]);

        res.json({ games: result.rows });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Public: Fetch categories with game assignments
// =========================================

router.get('/categories', async (req, res, next) => {
    try {
        const tenantId = req.tenantId || 'stem_default';

        const categories = await db.query(`
            SELECT id, name, slug, description, icon_emoji, icon_color, sort_order
            FROM game_categories
            WHERE tenant_id = $1 AND is_active = TRUE
            ORDER BY sort_order ASC, name ASC
        `, [tenantId]);

        const assignments = await db.query(`
            SELECT category_id, game_id
            FROM game_category_assignments
            WHERE tenant_id = $1
            ORDER BY sort_order ASC
        `, [tenantId]);

        // Group game IDs by category
        const categoryGames = {};
        for (const a of assignments.rows) {
            if (!categoryGames[a.category_id]) categoryGames[a.category_id] = [];
            categoryGames[a.category_id].push(a.game_id);
        }

        const result = categories.rows.map(c => ({
            ...c,
            gameIds: categoryGames[c.id] || []
        }));

        res.json({ categories: result });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Admin: List all categories
// =========================================

router.get('/categories/all', authenticate, requireAdmin('admin'), async (req, res, next) => {
    try {
        const tenantId = req.player.tenantId;

        const result = await db.query(`
            SELECT gc.*,
                   (SELECT COUNT(*) FROM game_category_assignments gca
                    WHERE gca.category_id = gc.id AND gca.tenant_id = gc.tenant_id) as game_count
            FROM game_categories gc
            WHERE gc.tenant_id = $1
            ORDER BY gc.sort_order ASC, gc.name ASC
        `, [tenantId]);

        res.json({ categories: result.rows });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Admin: Create a category
// =========================================

router.post('/categories', authenticate, requireAdmin('admin'), async (req, res, next) => {
    try {
        const tenantId = req.player.tenantId;
        const { name, description, iconEmoji, iconColor, sortOrder } = req.body;

        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Category name is required' });
        }

        // Generate slug from name
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const id = slug;

        // Check for duplicate
        const existing = await db.query(
            'SELECT id FROM game_categories WHERE (id = $1 OR slug = $2) AND tenant_id = $3',
            [id, slug, tenantId]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'A category with this name already exists' });
        }

        const result = await db.query(`
            INSERT INTO game_categories (id, tenant_id, name, slug, description, icon_emoji, icon_color, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [id, tenantId, name.trim(), slug, description || null,
            iconEmoji || '📁', iconColor || '#667eea', sortOrder || 100]);

        res.status(201).json({ category: result.rows[0] });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Admin: Update a category
// =========================================

router.put('/categories/:id', authenticate, requireAdmin('admin'), async (req, res, next) => {
    try {
        const tenantId = req.player.tenantId;
        const categoryId = req.params.id;
        const { name, description, iconEmoji, iconColor, sortOrder, isActive } = req.body;

        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Category name is required' });
        }

        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

        const result = await db.query(`
            UPDATE game_categories
            SET name = $1, slug = $2, description = $3, icon_emoji = $4,
                icon_color = $5, sort_order = $6, is_active = $7, updated_at = NOW()
            WHERE id = $8 AND tenant_id = $9
            RETURNING *
        `, [name.trim(), slug, description || null,
            iconEmoji || '📁', iconColor || '#667eea', sortOrder || 100,
            isActive !== undefined ? isActive : true,
            categoryId, tenantId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Category not found' });
        }

        res.json({ category: result.rows[0] });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Admin: Delete a category
// =========================================

router.delete('/categories/:id', authenticate, requireAdmin('admin'), async (req, res, next) => {
    try {
        const tenantId = req.player.tenantId;
        const categoryId = req.params.id;

        const result = await db.query(
            'DELETE FROM game_categories WHERE id = $1 AND tenant_id = $2 RETURNING id',
            [categoryId, tenantId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Category not found' });
        }

        res.json({ message: 'Category deleted' });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Admin: Assign categories to a game
// =========================================

router.put('/:id/categories', authenticate, requireAdmin('admin'), async (req, res, next) => {
    try {
        const tenantId = req.player.tenantId;
        const gameId = req.params.id;
        const { categoryIds } = req.body;

        if (!Array.isArray(categoryIds)) {
            return res.status(400).json({ error: 'categoryIds must be an array' });
        }

        // Remove existing assignments
        await db.query(
            'DELETE FROM game_category_assignments WHERE game_id = $1 AND tenant_id = $2',
            [gameId, tenantId]
        );

        // Insert new assignments
        for (let i = 0; i < categoryIds.length; i++) {
            await db.query(`
                INSERT INTO game_category_assignments (tenant_id, game_id, category_id, sort_order)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (tenant_id, game_id, category_id) DO NOTHING
            `, [tenantId, gameId, categoryIds[i], i * 10]);
        }

        // Also update the primary category_id on custom_games if it exists
        if (categoryIds.length > 0) {
            await db.query(
                'UPDATE custom_games SET category_id = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
                [categoryIds[0], gameId, tenantId]
            );
        }

        res.json({ message: 'Categories updated', gameId, categoryIds });
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
            SELECT cg.*, p.display_name as created_by_name,
                   COALESCE(
                       (SELECT json_agg(gca.category_id)
                        FROM game_category_assignments gca
                        WHERE gca.game_id = cg.id AND gca.tenant_id = cg.tenant_id),
                       '[]'::json
                   ) as categories
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
        const { id, title, classic, characterId, mechanic, iconColor, iconEmoji, sceneCode, sortOrder, categoryIds } = req.body;

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

        const primaryCategoryId = Array.isArray(categoryIds) && categoryIds.length > 0 ? categoryIds[0] : null;

        const result = await db.query(`
            INSERT INTO custom_games (id, tenant_id, title, classic, character_id, mechanic, icon_color, icon_emoji, scene_code, sort_order, category_id, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
        `, [id, tenantId, title, classic || null, characterId || null, mechanic || null,
            iconColor || '#333', iconEmoji || '?', sceneCode, sortOrder || 100, primaryCategoryId, adminId]);

        // Assign categories
        if (Array.isArray(categoryIds)) {
            for (let i = 0; i < categoryIds.length; i++) {
                await db.query(`
                    INSERT INTO game_category_assignments (tenant_id, game_id, category_id, sort_order)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (tenant_id, game_id, category_id) DO NOTHING
                `, [tenantId, id, categoryIds[i], i * 10]);
            }
        }

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
        const { title, classic, characterId, mechanic, iconColor, iconEmoji, sceneCode, sortOrder, categoryIds } = req.body;

        if (!title || !sceneCode) {
            return res.status(400).json({ error: 'title and sceneCode are required' });
        }

        const primaryCategoryId = Array.isArray(categoryIds) && categoryIds.length > 0 ? categoryIds[0] : null;

        const result = await db.query(`
            UPDATE custom_games
            SET title = $1, classic = $2, character_id = $3, mechanic = $4,
                icon_color = $5, icon_emoji = $6, scene_code = $7, sort_order = $8,
                category_id = $9, updated_at = NOW()
            WHERE id = $10 AND tenant_id = $11
            RETURNING *
        `, [title, classic || null, characterId || null, mechanic || null,
            iconColor || '#333', iconEmoji || '?', sceneCode, sortOrder || 100,
            primaryCategoryId, gameId, tenantId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Game not found' });
        }

        // Update category assignments
        if (Array.isArray(categoryIds)) {
            await db.query(
                'DELETE FROM game_category_assignments WHERE game_id = $1 AND tenant_id = $2',
                [gameId, tenantId]
            );
            for (let i = 0; i < categoryIds.length; i++) {
                await db.query(`
                    INSERT INTO game_category_assignments (tenant_id, game_id, category_id, sort_order)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (tenant_id, game_id, category_id) DO NOTHING
                `, [tenantId, gameId, categoryIds[i], i * 10]);
            }
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

        // Remove category assignments first
        await db.query(
            'DELETE FROM game_category_assignments WHERE game_id = $1 AND tenant_id = $2',
            [gameId, tenantId]
        );

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
