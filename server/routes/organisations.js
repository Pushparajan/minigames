/**
 * Organisation Routes
 * ====================
 * CRUD for organisations (workspaces).
 * Organisation creation is gated behind the 'organisations' entitlement
 * for non-free plans. Free users get a default personal workspace.
 *
 * POST /organisations          - Create organisation
 * GET  /organisations          - List player's organisations
 * GET  /organisations/:id      - Get organisation details
 * POST /organisations/:id/members - Add member
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../models/db');
const subscriptionSync = require('../services/subscriptionSync');

const router = express.Router();

/**
 * Create a new organisation.
 * Free users can create one org (personal workspace).
 * The 'organisations' entitlement allows creating team orgs.
 */
router.post('/', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const { name, slug } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Organisation name required' });
        }

        const orgSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 128);

        // Check if player already owns an org (free users: 1 max)
        const existingOrgs = await db.query(
            'SELECT id FROM organisations WHERE owner_id = $1 AND tenant_id = $2',
            [playerId, tenantId]
        );

        if (existingOrgs.rows.length > 0) {
            // Check if they have entitlement for multiple orgs
            const { checkEntitlement } = require('../middleware/entitlements');
            const firstOrg = existingOrgs.rows[0];
            const hasOrgEntitlement = await checkEntitlement(firstOrg.id, 'organisations');

            if (!hasOrgEntitlement) {
                return res.status(403).json({
                    error: 'Free plan allows only one workspace. Upgrade to create more.',
                    code: 'ENTITLEMENT_REQUIRED',
                    feature: 'organisations',
                    upgrade: true
                });
            }
        }

        // Check slug uniqueness
        const slugExists = await db.query(
            'SELECT 1 FROM organisations WHERE tenant_id = $1 AND slug = $2',
            [tenantId, orgSlug]
        );
        if (slugExists.rows.length > 0) {
            return res.status(409).json({ error: 'Organisation slug already taken' });
        }

        const orgId = uuidv4();

        await db.transaction(async (client) => {
            await client.query(`
                INSERT INTO organisations (id, tenant_id, name, slug, owner_id)
                VALUES ($1, $2, $3, $4, $5)
            `, [orgId, tenantId, name, orgSlug, playerId]);

            // Add owner as member
            await client.query(`
                INSERT INTO organisation_members (organisation_id, player_id, tenant_id, role)
                VALUES ($1, $2, $3, 'owner')
            `, [orgId, playerId, tenantId]);
        });

        // Provision free-tier entitlements
        await subscriptionSync.provisionEntitlements(orgId, null, tenantId, 'free');

        res.status(201).json({
            id: orgId,
            name,
            slug: orgSlug,
            role: 'owner'
        });
    } catch (err) {
        next(err);
    }
});

/**
 * List player's organisations.
 */
router.get('/', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;

        const result = await db.query(`
            SELECT o.id, o.name, o.slug, o.created_at, om.role,
                   (SELECT plan_tier FROM subscriptions WHERE organisation_id = o.id AND status IN ('active', 'trialing') ORDER BY created_at DESC LIMIT 1) as plan
            FROM organisations o
            JOIN organisation_members om ON o.id = om.organisation_id
            WHERE om.player_id = $1 AND om.tenant_id = $2
            ORDER BY om.joined_at
        `, [playerId, tenantId]);

        res.json({
            organisations: result.rows.map(row => ({
                id: row.id,
                name: row.name,
                slug: row.slug,
                role: row.role,
                plan: row.plan || 'free',
                createdAt: row.created_at
            }))
        });
    } catch (err) {
        next(err);
    }
});

/**
 * Get organisation details.
 */
router.get('/:id', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const orgId = req.params.id;

        const result = await db.query(`
            SELECT o.*, om.role FROM organisations o
            JOIN organisation_members om ON o.id = om.organisation_id
            WHERE o.id = $1 AND om.player_id = $2
        `, [orgId, playerId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Organisation not found' });
        }

        const org = result.rows[0];

        // Get member count
        const memberCount = await db.query(
            'SELECT COUNT(*) FROM organisation_members WHERE organisation_id = $1',
            [orgId]
        );

        // Get subscription info
        const subResult = await db.query(
            "SELECT * FROM subscriptions WHERE organisation_id = $1 AND status IN ('active', 'trialing', 'past_due') ORDER BY created_at DESC LIMIT 1",
            [orgId]
        );

        res.json({
            id: org.id,
            name: org.name,
            slug: org.slug,
            role: org.role,
            memberCount: parseInt(memberCount.rows[0].count, 10),
            subscription: subResult.rows[0] ? {
                status: subResult.rows[0].status,
                planTier: subResult.rows[0].plan_tier,
                currentPeriodEnd: subResult.rows[0].current_period_end
            } : null,
            createdAt: org.created_at
        });
    } catch (err) {
        next(err);
    }
});

/**
 * Add a member to an organisation.
 * Gated by max_members limit.
 */
router.post('/:id/members', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const orgId = req.params.id;
        const { memberId, role } = req.body;

        if (!memberId) {
            return res.status(400).json({ error: 'memberId required' });
        }

        // Verify requester is owner/admin
        const memberCheck = await db.query(
            "SELECT role FROM organisation_members WHERE organisation_id = $1 AND player_id = $2 AND role IN ('owner', 'admin')",
            [orgId, playerId]
        );
        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Only owners and admins can add members' });
        }

        // Check member limit
        const { getLimit, getCurrentUsage } = require('../middleware/entitlements');
        const limit = await getLimit(orgId, 'max_members');
        if (limit !== null) {
            const current = await getCurrentUsage(orgId, 'max_members');
            if (current >= limit) {
                return res.status(403).json({
                    error: `Member limit reached (${current}/${limit}). Upgrade to add more.`,
                    code: 'LIMIT_EXCEEDED',
                    feature: 'max_members',
                    upgrade: true
                });
            }
        }

        await db.query(`
            INSERT INTO organisation_members (organisation_id, player_id, tenant_id, role)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (organisation_id, player_id) DO UPDATE SET role = EXCLUDED.role
        `, [orgId, memberId, tenantId, role || 'member']);

        res.status(201).json({ message: 'Member added', organisationId: orgId, memberId });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
