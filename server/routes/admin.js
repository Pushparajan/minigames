/**
 * Admin Console API Routes
 * ==========================
 * Moderation queue, content management, user management,
 * and dashboard stats for admin users.
 *
 * All routes require admin role via requireAdmin middleware.
 *
 * Dashboard:
 *   GET  /admin/stats                    — Overview stats
 *
 * Moderation Queue:
 *   GET  /admin/queue                    — Items needing review
 *   GET  /admin/reports                  — Open content reports
 *
 * Content Actions:
 *   POST /admin/comments/:id/approve     — Approve hidden comment
 *   POST /admin/comments/:id/hide        — Hide a comment
 *   POST /admin/comments/:id/remove      — Permanently remove
 *   POST /admin/comments/:id/restore     — Restore removed comment
 *   POST /admin/reviews/:id/approve      — Approve hidden review
 *   POST /admin/reviews/:id/hide         — Hide a review
 *   POST /admin/reviews/:id/remove       — Permanently remove
 *
 * Report Actions:
 *   POST /admin/reports/:id/resolve      — Resolve a report
 *   POST /admin/reports/:id/dismiss      — Dismiss a report
 *
 * User Management:
 *   GET  /admin/users                    — List/search users
 *   GET  /admin/users/:id               — User detail + history
 *   POST /admin/users/:id/warn          — Warn a user
 *   POST /admin/users/:id/ban           — Ban a user
 *   POST /admin/users/:id/role          — Set admin role
 */

const express = require('express');
const db = require('../models/db');
const { requireAdmin } = require('../middleware/admin');

const router = express.Router();

// All admin routes require at least moderator role
router.use(requireAdmin('moderator'));

// =========================================
// Dashboard Stats
// =========================================

router.get('/stats', async (req, res, next) => {
    try {
        const tenantId = req.player.tenantId;

        const [comments, reviews, reports, players] = await Promise.all([
            db.query(`
                SELECT status, COUNT(*) as count FROM comments
                WHERE tenant_id = $1 GROUP BY status
            `, [tenantId]),
            db.query(`
                SELECT status, COUNT(*) as count FROM game_reviews
                WHERE tenant_id = $1 GROUP BY status
            `, [tenantId]),
            db.query(`
                SELECT status, COUNT(*) as count FROM content_reports
                WHERE tenant_id = $1 GROUP BY status
            `, [tenantId]),
            db.query(`
                SELECT COUNT(*) as total,
                       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as new_today,
                       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as new_week
                FROM players WHERE tenant_id = $1
            `, [tenantId])
        ]);

        const commentStats = {};
        comments.rows.forEach(r => commentStats[r.status] = parseInt(r.count, 10));
        const reviewStats = {};
        reviews.rows.forEach(r => reviewStats[r.status] = parseInt(r.count, 10));
        const reportStats = {};
        reports.rows.forEach(r => reportStats[r.status] = parseInt(r.count, 10));

        const flaggedComments = await db.query(
            'SELECT COUNT(*) FROM comments WHERE tenant_id = $1 AND report_count > 0 AND status = $2',
            [tenantId, 'published']
        );

        res.json({
            comments: { ...commentStats, flagged: parseInt(flaggedComments.rows[0].count, 10) },
            reviews: reviewStats,
            reports: reportStats,
            players: {
                total: parseInt(players.rows[0].total, 10),
                newToday: parseInt(players.rows[0].new_today, 10),
                newThisWeek: parseInt(players.rows[0].new_week, 10)
            }
        });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Moderation Queue
// =========================================

router.get('/queue', async (req, res, next) => {
    try {
        const tenantId = req.player.tenantId;
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
        const offset = parseInt(req.query.offset, 10) || 0;
        const type = req.query.type; // 'comment', 'review', or null for both

        const items = [];

        if (!type || type === 'comment') {
            const flagged = await db.query(`
                SELECT c.id, 'comment' as type, c.body, c.status, c.report_count,
                       c.game_id, c.created_at,
                       p.display_name as author_name, p.id as author_id
                FROM comments c
                JOIN players p ON p.id = c.player_id AND p.tenant_id = c.tenant_id
                WHERE c.tenant_id = $1
                    AND (c.status IN ('pending', 'hidden') OR c.report_count > 0)
                ORDER BY c.report_count DESC, c.created_at DESC
                LIMIT $2 OFFSET $3
            `, [tenantId, limit, offset]);
            items.push(...flagged.rows);
        }

        if (!type || type === 'review') {
            const flagged = await db.query(`
                SELECT r.id, 'review' as type, r.body, r.title, r.rating, r.status,
                       r.game_id, r.created_at,
                       p.display_name as author_name, p.id as author_id,
                       (SELECT COUNT(*) FROM content_reports cr
                        WHERE cr.content_type = 'review' AND cr.content_id = r.id AND cr.status = 'open') as report_count
                FROM game_reviews r
                JOIN players p ON p.id = r.player_id AND p.tenant_id = r.tenant_id
                WHERE r.tenant_id = $1
                    AND r.status IN ('pending', 'hidden')
                ORDER BY r.created_at DESC
                LIMIT $2 OFFSET $3
            `, [tenantId, limit, offset]);
            items.push(...flagged.rows);
        }

        // Sort combined by report count desc, then date
        items.sort((a, b) => {
            const ra = parseInt(a.report_count, 10) || 0;
            const rb = parseInt(b.report_count, 10) || 0;
            if (rb !== ra) return rb - ra;
            return new Date(b.created_at) - new Date(a.created_at);
        });

        res.json({ queue: items, total: items.length });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Reports
// =========================================

router.get('/reports', async (req, res, next) => {
    try {
        const tenantId = req.player.tenantId;
        const status = req.query.status || 'open';
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
        const offset = parseInt(req.query.offset, 10) || 0;

        const result = await db.query(`
            SELECT cr.*, p.display_name as reporter_name
            FROM content_reports cr
            JOIN players p ON p.id = cr.reporter_id AND p.tenant_id = cr.tenant_id
            WHERE cr.tenant_id = $1 AND cr.status = $2
            ORDER BY cr.created_at DESC
            LIMIT $3 OFFSET $4
        `, [tenantId, status, limit, offset]);

        const countResult = await db.query(
            'SELECT COUNT(*) FROM content_reports WHERE tenant_id = $1 AND status = $2',
            [tenantId, status]
        );

        res.json({
            reports: result.rows,
            total: parseInt(countResult.rows[0].count, 10),
            limit,
            offset
        });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Comment Moderation Actions
// =========================================

async function _moderateComment(req, res, next, newStatus, action) {
    try {
        const adminId = req.player.id;
        const tenantId = req.player.tenantId;
        const { id } = req.params;
        const { reason } = req.body;

        const result = await db.query(`
            UPDATE comments SET status = $1, moderated_by = $2, moderated_at = NOW(),
                moderation_note = $3
            WHERE id = $4 AND tenant_id = $5
            RETURNING id, status, player_id
        `, [newStatus, adminId, reason || null, id, tenantId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Comment not found' });
        }

        // Log moderation action
        await db.query(`
            INSERT INTO moderation_log (admin_id, tenant_id, action, content_type, content_id, target_player_id, reason)
            VALUES ($1, $2, $3, 'comment', $4, $5, $6)
        `, [adminId, tenantId, action, id, result.rows[0].player_id, reason || null]);

        res.json({ message: `Comment ${action}d`, comment: result.rows[0] });
    } catch (err) {
        next(err);
    }
}

router.post('/comments/:id/approve', (req, res, next) => _moderateComment(req, res, next, 'published', 'approve'));
router.post('/comments/:id/hide', (req, res, next) => _moderateComment(req, res, next, 'hidden', 'hide'));
router.post('/comments/:id/remove', (req, res, next) => _moderateComment(req, res, next, 'removed', 'remove'));
router.post('/comments/:id/restore', (req, res, next) => _moderateComment(req, res, next, 'published', 'restore'));

// =========================================
// Review Moderation Actions
// =========================================

async function _moderateReview(req, res, next, newStatus, action) {
    try {
        const adminId = req.player.id;
        const tenantId = req.player.tenantId;
        const { id } = req.params;
        const { reason } = req.body;

        const result = await db.query(`
            UPDATE game_reviews SET status = $1, moderated_by = $2, moderated_at = NOW(),
                moderation_note = $3
            WHERE id = $4 AND tenant_id = $5
            RETURNING id, status, player_id
        `, [newStatus, adminId, reason || null, id, tenantId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Review not found' });
        }

        await db.query(`
            INSERT INTO moderation_log (admin_id, tenant_id, action, content_type, content_id, target_player_id, reason)
            VALUES ($1, $2, $3, 'review', $4, $5, $6)
        `, [adminId, tenantId, action, id, result.rows[0].player_id, reason || null]);

        res.json({ message: `Review ${action}d`, review: result.rows[0] });
    } catch (err) {
        next(err);
    }
}

router.post('/reviews/:id/approve', (req, res, next) => _moderateReview(req, res, next, 'published', 'approve'));
router.post('/reviews/:id/hide', (req, res, next) => _moderateReview(req, res, next, 'hidden', 'hide'));
router.post('/reviews/:id/remove', (req, res, next) => _moderateReview(req, res, next, 'removed', 'remove'));

// =========================================
// Report Resolution
// =========================================

router.post('/reports/:id/resolve', async (req, res, next) => {
    try {
        const adminId = req.player.id;
        const tenantId = req.player.tenantId;
        const { id } = req.params;
        const { note, action } = req.body;
        // action: 'hide_content', 'remove_content', 'warn_user', 'no_action'

        const result = await db.query(`
            UPDATE content_reports SET status = 'resolved', resolved_by = $1,
                resolved_at = NOW(), resolution_note = $2
            WHERE id = $3 AND tenant_id = $4 AND status = 'open'
            RETURNING *
        `, [adminId, note || null, id, tenantId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Report not found or already resolved' });
        }

        const report = result.rows[0];

        // Auto-apply action to content
        if (action === 'hide_content' || action === 'remove_content') {
            const newStatus = action === 'hide_content' ? 'hidden' : 'removed';
            const table = report.content_type === 'comment' ? 'comments' : 'game_reviews';
            await db.query(
                `UPDATE ${table} SET status = $1, moderated_by = $2, moderated_at = NOW() WHERE id = $3`,
                [newStatus, adminId, report.content_id]
            );
        }

        await db.query(`
            INSERT INTO moderation_log (admin_id, tenant_id, action, content_type, content_id, reason)
            VALUES ($1, $2, 'resolve_report', $3, $4, $5)
        `, [adminId, tenantId, report.content_type, report.content_id, note || action]);

        res.json({ message: 'Report resolved', report: result.rows[0] });
    } catch (err) {
        next(err);
    }
});

router.post('/reports/:id/dismiss', async (req, res, next) => {
    try {
        const adminId = req.player.id;
        const tenantId = req.player.tenantId;
        const { id } = req.params;
        const { note } = req.body;

        const result = await db.query(`
            UPDATE content_reports SET status = 'dismissed', resolved_by = $1,
                resolved_at = NOW(), resolution_note = $2
            WHERE id = $3 AND tenant_id = $4 AND status = 'open'
            RETURNING id
        `, [adminId, note || null, id, tenantId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Report not found' });
        }

        await db.query(`
            INSERT INTO moderation_log (admin_id, tenant_id, action, content_type, content_id, reason)
            VALUES ($1, $2, 'dismiss_report', NULL, $3, $4)
        `, [adminId, tenantId, id, note || null]);

        res.json({ message: 'Report dismissed' });
    } catch (err) {
        next(err);
    }
});

// =========================================
// User Management
// =========================================

router.get('/users', async (req, res, next) => {
    try {
        const tenantId = req.player.tenantId;
        const search = req.query.search || '';
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
        const offset = parseInt(req.query.offset, 10) || 0;

        let query, params;
        if (search) {
            query = `
                SELECT id, display_name, email, avatar_character, is_guest, admin_role,
                       total_score, games_played, created_at, last_login_at
                FROM players
                WHERE tenant_id = $1 AND (display_name ILIKE $2 OR email ILIKE $2)
                ORDER BY created_at DESC LIMIT $3 OFFSET $4
            `;
            params = [tenantId, `%${search}%`, limit, offset];
        } else {
            query = `
                SELECT id, display_name, email, avatar_character, is_guest, admin_role,
                       total_score, games_played, created_at, last_login_at
                FROM players
                WHERE tenant_id = $1
                ORDER BY created_at DESC LIMIT $2 OFFSET $3
            `;
            params = [tenantId, limit, offset];
        }

        const result = await db.query(query, params);
        res.json({ users: result.rows, limit, offset });
    } catch (err) {
        next(err);
    }
});

router.get('/users/:id', async (req, res, next) => {
    try {
        const tenantId = req.player.tenantId;
        const userId = req.params.id;

        const [player, commentCount, reviewCount, reportCount, modActions] = await Promise.all([
            db.query(
                'SELECT id, display_name, email, avatar_character, is_guest, admin_role, total_score, games_played, created_at, last_login_at FROM players WHERE id = $1 AND tenant_id = $2',
                [userId, tenantId]
            ),
            db.query(
                'SELECT COUNT(*) FROM comments WHERE player_id = $1 AND tenant_id = $2',
                [userId, tenantId]
            ),
            db.query(
                'SELECT COUNT(*) FROM game_reviews WHERE player_id = $1 AND tenant_id = $2',
                [userId, tenantId]
            ),
            db.query(
                "SELECT COUNT(*) FROM content_reports cr JOIN comments c ON c.id = cr.content_id WHERE c.player_id = $1 AND cr.tenant_id = $2 AND cr.content_type = 'comment'",
                [userId, tenantId]
            ),
            db.query(
                'SELECT * FROM moderation_log WHERE target_player_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 20',
                [userId, tenantId]
            )
        ]);

        if (player.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            user: player.rows[0],
            stats: {
                comments: parseInt(commentCount.rows[0].count, 10),
                reviews: parseInt(reviewCount.rows[0].count, 10),
                reportsAgainst: parseInt(reportCount.rows[0].count, 10)
            },
            moderationHistory: modActions.rows
        });
    } catch (err) {
        next(err);
    }
});

router.post('/users/:id/warn', async (req, res, next) => {
    try {
        const adminId = req.player.id;
        const tenantId = req.player.tenantId;
        const userId = req.params.id;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ error: 'Reason required' });
        }

        await db.query(`
            INSERT INTO moderation_log (admin_id, tenant_id, action, content_type, target_player_id, reason)
            VALUES ($1, $2, 'warn_user', 'player', $3, $4)
        `, [adminId, tenantId, userId, reason]);

        res.json({ message: 'Warning recorded' });
    } catch (err) {
        next(err);
    }
});

router.post('/users/:id/ban', requireAdmin('admin'), async (req, res, next) => {
    try {
        const adminId = req.player.id;
        const tenantId = req.player.tenantId;
        const userId = req.params.id;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ error: 'Reason required' });
        }

        // Hide all user content
        await db.query(
            "UPDATE comments SET status = 'hidden' WHERE player_id = $1 AND tenant_id = $2",
            [userId, tenantId]
        );
        await db.query(
            "UPDATE game_reviews SET status = 'hidden' WHERE player_id = $1 AND tenant_id = $2",
            [userId, tenantId]
        );

        await db.query(`
            INSERT INTO moderation_log (admin_id, tenant_id, action, content_type, target_player_id, reason)
            VALUES ($1, $2, 'ban_user', 'player', $3, $4)
        `, [adminId, tenantId, userId, reason]);

        res.json({ message: 'User banned and content hidden' });
    } catch (err) {
        next(err);
    }
});

router.post('/users/:id/role', requireAdmin('super_admin'), async (req, res, next) => {
    try {
        const tenantId = req.player.tenantId;
        const userId = req.params.id;
        const { role } = req.body;

        const validRoles = [null, 'moderator', 'admin', 'super_admin'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ error: `Role must be one of: ${validRoles.join(', ')}` });
        }

        await db.query(
            'UPDATE players SET admin_role = $1 WHERE id = $2 AND tenant_id = $3',
            [role, userId, tenantId]
        );

        await db.query(`
            INSERT INTO moderation_log (admin_id, tenant_id, action, content_type, target_player_id, reason, metadata)
            VALUES ($1, $2, 'set_role', 'player', $3, $4, $5)
        `, [req.player.id, tenantId, userId, `Role set to ${role || 'none'}`, JSON.stringify({ newRole: role })]);

        res.json({ message: `User role updated to ${role || 'none'}` });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Moderation Log (audit)
// =========================================

router.get('/log', async (req, res, next) => {
    try {
        const tenantId = req.player.tenantId;
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
        const offset = parseInt(req.query.offset, 10) || 0;

        const result = await db.query(`
            SELECT ml.*, p.display_name as admin_name
            FROM moderation_log ml
            JOIN players p ON p.id = ml.admin_id AND p.tenant_id = ml.tenant_id
            WHERE ml.tenant_id = $1
            ORDER BY ml.created_at DESC
            LIMIT $2 OFFSET $3
        `, [tenantId, limit, offset]);

        res.json({ log: result.rows, limit, offset });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
