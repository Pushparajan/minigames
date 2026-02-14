/**
 * Comments & Reviews Routes
 * ===========================
 * Public-facing endpoints for user comments and game reviews.
 *
 * Comments:
 *   GET    /comments/:gameId          — List comments for a game
 *   POST   /comments/:gameId          — Post a comment
 *   PUT    /comments/:commentId       — Edit own comment
 *   DELETE /comments/:commentId       — Delete own comment
 *   POST   /comments/:commentId/report — Report a comment
 *
 * Reviews:
 *   GET    /comments/:gameId/reviews       — List reviews for a game
 *   POST   /comments/:gameId/reviews       — Post/update a review
 *   DELETE /comments/:gameId/reviews       — Delete own review
 *   POST   /comments/reviews/:reviewId/report — Report a review
 */

const express = require('express');
const db = require('../models/db');
const { authenticate, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// =========================================
// Comments
// =========================================

/**
 * List comments for a game (paginated, threaded).
 */
router.get('/:gameId', optionalAuth, async (req, res, next) => {
    try {
        const tenantId = req.player?.tenantId || req.tenantId;
        const { gameId } = req.params;
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
        const offset = parseInt(req.query.offset, 10) || 0;

        // Get top-level comments
        const result = await db.query(`
            SELECT c.id, c.body, c.parent_id, c.created_at, c.edited_at,
                   p.display_name, p.avatar_character, c.player_id,
                   (SELECT COUNT(*) FROM comments r WHERE r.parent_id = c.id AND r.status = 'published') as reply_count
            FROM comments c
            JOIN players p ON p.id = c.player_id AND p.tenant_id = c.tenant_id
            WHERE c.tenant_id = $1 AND c.game_id = $2 AND c.status = 'published' AND c.parent_id IS NULL
            ORDER BY c.created_at DESC
            LIMIT $3 OFFSET $4
        `, [tenantId, gameId, limit, offset]);

        const countResult = await db.query(
            "SELECT COUNT(*) FROM comments WHERE tenant_id = $1 AND game_id = $2 AND status = 'published' AND parent_id IS NULL",
            [tenantId, gameId]
        );

        res.json({
            comments: result.rows.map(_formatComment),
            total: parseInt(countResult.rows[0].count, 10),
            limit,
            offset
        });
    } catch (err) {
        next(err);
    }
});

/**
 * Get replies for a comment.
 */
router.get('/:gameId/thread/:commentId', optionalAuth, async (req, res, next) => {
    try {
        const tenantId = req.player?.tenantId || req.tenantId;
        const { commentId } = req.params;

        const result = await db.query(`
            SELECT c.id, c.body, c.parent_id, c.created_at, c.edited_at,
                   p.display_name, p.avatar_character, c.player_id
            FROM comments c
            JOIN players p ON p.id = c.player_id AND p.tenant_id = c.tenant_id
            WHERE c.tenant_id = $1 AND c.parent_id = $2 AND c.status = 'published'
            ORDER BY c.created_at ASC
        `, [tenantId, commentId]);

        res.json({ replies: result.rows.map(_formatComment) });
    } catch (err) {
        next(err);
    }
});

/**
 * Post a comment.
 */
router.post('/:gameId', authenticate, async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const { gameId } = req.params;
        const { body, parentId } = req.body;

        if (!body || body.trim().length === 0) {
            return res.status(400).json({ error: 'Comment body required' });
        }
        if (body.length > 2000) {
            return res.status(400).json({ error: 'Comment too long (max 2000 chars)' });
        }

        // Validate parent exists if replying
        if (parentId) {
            const parent = await db.query(
                "SELECT id FROM comments WHERE id = $1 AND game_id = $2 AND status = 'published'",
                [parentId, gameId]
            );
            if (parent.rows.length === 0) {
                return res.status(404).json({ error: 'Parent comment not found' });
            }
        }

        const result = await db.query(`
            INSERT INTO comments (player_id, tenant_id, game_id, parent_id, body)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, body, parent_id, created_at
        `, [playerId, tenantId, gameId, parentId || null, body.trim()]);

        res.status(201).json({ comment: result.rows[0] });
    } catch (err) {
        next(err);
    }
});

/**
 * Edit own comment.
 */
router.put('/:commentId', authenticate, async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const { commentId } = req.params;
        const { body } = req.body;

        if (!body || body.trim().length === 0) {
            return res.status(400).json({ error: 'Comment body required' });
        }
        if (body.length > 2000) {
            return res.status(400).json({ error: 'Comment too long (max 2000 chars)' });
        }

        const result = await db.query(`
            UPDATE comments SET body = $1, edited_at = NOW()
            WHERE id = $2 AND player_id = $3 AND tenant_id = $4 AND status = 'published'
            RETURNING id, body, edited_at
        `, [body.trim(), commentId, playerId, tenantId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Comment not found or not yours' });
        }

        res.json({ comment: result.rows[0] });
    } catch (err) {
        next(err);
    }
});

/**
 * Delete own comment (soft-delete).
 */
router.delete('/:commentId', authenticate, async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const { commentId } = req.params;

        const result = await db.query(`
            UPDATE comments SET status = 'removed'
            WHERE id = $1 AND player_id = $2 AND tenant_id = $3 AND status = 'published'
            RETURNING id
        `, [commentId, playerId, tenantId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Comment not found or not yours' });
        }

        res.json({ message: 'Comment deleted' });
    } catch (err) {
        next(err);
    }
});

/**
 * Report a comment.
 */
router.post('/:commentId/report', authenticate, async (req, res, next) => {
    try {
        const reporterId = req.player.id;
        const tenantId = req.player.tenantId;
        const { commentId } = req.params;
        const { reason, description } = req.body;

        const validReasons = ['spam', 'harassment', 'inappropriate', 'off_topic', 'other'];
        if (!reason || !validReasons.includes(reason)) {
            return res.status(400).json({ error: `Reason must be one of: ${validReasons.join(', ')}` });
        }

        // Check comment exists
        const comment = await db.query(
            'SELECT id FROM comments WHERE id = $1 AND tenant_id = $2',
            [commentId, tenantId]
        );
        if (comment.rows.length === 0) {
            return res.status(404).json({ error: 'Comment not found' });
        }

        await db.transaction(async (client) => {
            await client.query(`
                INSERT INTO content_reports (reporter_id, tenant_id, content_type, content_id, reason, description)
                VALUES ($1, $2, 'comment', $3, $4, $5)
                ON CONFLICT (reporter_id, content_type, content_id) DO NOTHING
            `, [reporterId, tenantId, commentId, reason, description || null]);

            await client.query(
                'UPDATE comments SET report_count = report_count + 1 WHERE id = $1',
                [commentId]
            );
        });

        res.json({ message: 'Report submitted' });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Reviews
// =========================================

/**
 * List reviews for a game.
 */
router.get('/:gameId/reviews', optionalAuth, async (req, res, next) => {
    try {
        const tenantId = req.player?.tenantId || req.tenantId;
        const { gameId } = req.params;
        const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
        const offset = parseInt(req.query.offset, 10) || 0;
        const sort = req.query.sort === 'rating' ? 'r.rating DESC' : 'r.created_at DESC';

        const result = await db.query(`
            SELECT r.id, r.rating, r.title, r.body, r.created_at, r.updated_at,
                   p.display_name, p.avatar_character, r.player_id
            FROM game_reviews r
            JOIN players p ON p.id = r.player_id AND p.tenant_id = r.tenant_id
            WHERE r.tenant_id = $1 AND r.game_id = $2 AND r.status = 'published'
            ORDER BY ${sort}
            LIMIT $3 OFFSET $4
        `, [tenantId, gameId, limit, offset]);

        // Aggregate stats
        const stats = await db.query(`
            SELECT COUNT(*) as total,
                   ROUND(AVG(rating)::numeric, 1) as avg_rating,
                   COUNT(*) FILTER (WHERE rating = 5) as five_star,
                   COUNT(*) FILTER (WHERE rating = 4) as four_star,
                   COUNT(*) FILTER (WHERE rating = 3) as three_star,
                   COUNT(*) FILTER (WHERE rating = 2) as two_star,
                   COUNT(*) FILTER (WHERE rating = 1) as one_star
            FROM game_reviews
            WHERE tenant_id = $1 AND game_id = $2 AND status = 'published'
        `, [tenantId, gameId]);

        const s = stats.rows[0];
        res.json({
            reviews: result.rows,
            stats: {
                total: parseInt(s.total, 10),
                averageRating: parseFloat(s.avg_rating) || 0,
                distribution: {
                    5: parseInt(s.five_star, 10),
                    4: parseInt(s.four_star, 10),
                    3: parseInt(s.three_star, 10),
                    2: parseInt(s.two_star, 10),
                    1: parseInt(s.one_star, 10)
                }
            },
            limit,
            offset
        });
    } catch (err) {
        next(err);
    }
});

/**
 * Post or update a review (1 per player per game).
 */
router.post('/:gameId/reviews', authenticate, async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const { gameId } = req.params;
        const { rating, title, body } = req.body;

        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'Rating must be 1-5' });
        }
        if (title && title.length > 200) {
            return res.status(400).json({ error: 'Title too long (max 200 chars)' });
        }
        if (body && body.length > 5000) {
            return res.status(400).json({ error: 'Review too long (max 5000 chars)' });
        }

        const result = await db.query(`
            INSERT INTO game_reviews (player_id, tenant_id, game_id, rating, title, body)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (player_id, tenant_id, game_id) DO UPDATE SET
                rating = EXCLUDED.rating,
                title = EXCLUDED.title,
                body = EXCLUDED.body,
                updated_at = NOW()
            RETURNING id, rating, title, body, created_at, updated_at
        `, [playerId, tenantId, gameId, rating, title || null, body || null]);

        res.status(201).json({ review: result.rows[0] });
    } catch (err) {
        next(err);
    }
});

/**
 * Delete own review.
 */
router.delete('/:gameId/reviews', authenticate, async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const { gameId } = req.params;

        const result = await db.query(`
            UPDATE game_reviews SET status = 'removed'
            WHERE player_id = $1 AND tenant_id = $2 AND game_id = $3 AND status = 'published'
            RETURNING id
        `, [playerId, tenantId, gameId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Review not found' });
        }

        res.json({ message: 'Review deleted' });
    } catch (err) {
        next(err);
    }
});

/**
 * Report a review.
 */
router.post('/reviews/:reviewId/report', authenticate, async (req, res, next) => {
    try {
        const reporterId = req.player.id;
        const tenantId = req.player.tenantId;
        const { reviewId } = req.params;
        const { reason, description } = req.body;

        const validReasons = ['spam', 'harassment', 'inappropriate', 'off_topic', 'other'];
        if (!reason || !validReasons.includes(reason)) {
            return res.status(400).json({ error: `Reason must be one of: ${validReasons.join(', ')}` });
        }

        await db.query(`
            INSERT INTO content_reports (reporter_id, tenant_id, content_type, content_id, reason, description)
            VALUES ($1, $2, 'review', $3, $4, $5)
            ON CONFLICT (reporter_id, content_type, content_id) DO NOTHING
        `, [reporterId, tenantId, reviewId, reason, description || null]);

        res.json({ message: 'Report submitted' });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Helpers
// =========================================

function _formatComment(row) {
    return {
        id: row.id,
        body: row.body,
        parentId: row.parent_id,
        author: {
            id: row.player_id,
            displayName: row.display_name,
            avatar: row.avatar_character
        },
        replyCount: row.reply_count ? parseInt(row.reply_count, 10) : undefined,
        createdAt: row.created_at,
        editedAt: row.edited_at
    };
}

module.exports = router;
