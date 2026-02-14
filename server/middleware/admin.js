/**
 * Admin Authorization Middleware
 * ================================
 * Role-based access control for admin/moderation endpoints.
 *
 * Roles (ascending privilege):
 *   moderator  — Can review/approve/hide comments and reviews
 *   admin      — Moderator + ban users, manage reports
 *   super_admin — Admin + manage other admin roles
 *
 * Usage:
 *   router.get('/queue', requireAdmin('moderator'), handler)
 *   router.post('/ban',  requireAdmin('admin'), handler)
 */

const db = require('../models/db');

const ROLE_HIERARCHY = {
    moderator: 1,
    admin: 2,
    super_admin: 3
};

/**
 * Require a minimum admin role.
 * Checks the player's admin_role in the database.
 *
 * @param {string} minRole - Minimum required role
 * @returns {Function} Express middleware
 */
function requireAdmin(minRole = 'moderator') {
    return async (req, res, next) => {
        try {
            const playerId = req.player?.id;
            const tenantId = req.player?.tenantId;

            if (!playerId) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            const result = await db.query(
                'SELECT admin_role FROM players WHERE id = $1 AND tenant_id = $2',
                [playerId, tenantId]
            );

            if (result.rows.length === 0) {
                return res.status(403).json({ error: 'Access denied' });
            }

            const playerRole = result.rows[0].admin_role;
            if (!playerRole || !ROLE_HIERARCHY[playerRole]) {
                return res.status(403).json({
                    error: 'Admin access required',
                    code: 'ADMIN_REQUIRED'
                });
            }

            const minLevel = ROLE_HIERARCHY[minRole] || 1;
            const playerLevel = ROLE_HIERARCHY[playerRole] || 0;

            if (playerLevel < minLevel) {
                return res.status(403).json({
                    error: `Requires ${minRole} role or higher`,
                    code: 'INSUFFICIENT_ROLE',
                    required: minRole,
                    current: playerRole
                });
            }

            req.player.adminRole = playerRole;
            next();
        } catch (err) {
            next(err);
        }
    };
}

module.exports = { requireAdmin, ROLE_HIERARCHY };
