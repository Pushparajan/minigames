/**
 * Virtual Economy & Battle Pass Routes
 * =======================================
 * Manages wallets, transactions, store purchases, battle pass
 * progression, and reward claims.
 *
 * Economy:
 *   GET    /economy/wallet              — Get player's wallet balances
 *   GET    /economy/transactions        — Transaction history
 *   POST   /economy/earn               — Award currency (internal/server use)
 *
 * Store:
 *   GET    /economy/store              — List store items
 *   POST   /economy/store/purchase     — Purchase an item
 *   GET    /economy/inventory          — Player's inventory
 *
 * Battle Pass:
 *   GET    /economy/battlepass          — Get current battle pass info
 *   GET    /economy/battlepass/progress — Get player's BP progress
 *   POST   /economy/battlepass/purchase — Purchase premium BP
 *   POST   /economy/battlepass/claim    — Claim tier reward
 *   POST   /economy/battlepass/xp       — Add XP (internal/server use)
 */

const express = require('express');
const db = require('../models/db');

const router = express.Router();

// =========================================
// Wallet
// =========================================

router.get('/wallet', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;

        const result = await db.query(`
            SELECT currency_type, balance, lifetime_earned
            FROM player_wallets
            WHERE player_id = $1 AND tenant_id = $2
            ORDER BY currency_type
        `, [playerId, tenantId]);

        // Ensure default currencies exist
        const wallets = {};
        for (const row of result.rows) {
            wallets[row.currency_type] = {
                balance: parseInt(row.balance, 10),
                lifetimeEarned: parseInt(row.lifetime_earned, 10)
            };
        }

        // Add defaults for missing currencies
        for (const ct of ['coins', 'gems', 'tickets']) {
            if (!wallets[ct]) {
                wallets[ct] = { balance: 0, lifetimeEarned: 0 };
            }
        }

        res.json({ wallets });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Transaction History
// =========================================

router.get('/transactions', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
        const offset = parseInt(req.query.offset, 10) || 0;

        const result = await db.query(`
            SELECT id, currency_type, amount, balance_after, tx_type, source, reference_id, created_at
            FROM economy_transactions
            WHERE player_id = $1 AND tenant_id = $2
            ORDER BY created_at DESC
            LIMIT $3 OFFSET $4
        `, [playerId, tenantId, limit, offset]);

        res.json({ transactions: result.rows, limit, offset });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Earn Currency (server-side award)
// =========================================

router.post('/earn', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const { currencyType, amount, source, referenceId } = req.body;

        if (!currencyType || !amount || amount <= 0) {
            return res.status(400).json({ error: 'currencyType and positive amount required' });
        }

        const validSources = ['match_win', 'battle_pass', 'daily_reward', 'achievement', 'admin_grant'];
        if (!validSources.includes(source)) {
            return res.status(400).json({ error: `Invalid source. Must be one of: ${validSources.join(', ')}` });
        }

        const newBalance = await _creditWallet(tenantId, playerId, currencyType, amount, 'earn', source, referenceId);

        res.json({
            message: `Earned ${amount} ${currencyType}`,
            balance: newBalance
        });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Store: List Items
// =========================================

router.get('/store', async (req, res, next) => {
    try {
        const tenantId = req.player?.tenantId || 'stem_default';
        const type = req.query.type;

        let query = 'SELECT * FROM store_items WHERE tenant_id = $1 AND is_active = TRUE';
        const params = [tenantId];

        if (type) {
            query += ' AND item_type = $2';
            params.push(type);
        }

        query += ' ORDER BY price ASC';

        const result = await db.query(query, params);
        res.json({ items: result.rows });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Store: Purchase Item
// =========================================

router.post('/store/purchase', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const { itemId } = req.body;

        if (!itemId) {
            return res.status(400).json({ error: 'itemId required' });
        }

        // Get item
        const item = await db.query(
            'SELECT * FROM store_items WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE',
            [itemId, tenantId]
        );

        if (item.rows.length === 0) {
            return res.status(404).json({ error: 'Item not found' });
        }

        const storeItem = item.rows[0];

        // Check if already owned
        const owned = await db.query(
            'SELECT id FROM player_inventory WHERE player_id = $1 AND item_id = $2 AND tenant_id = $3',
            [playerId, itemId, tenantId]
        );

        if (owned.rows.length > 0) {
            return res.status(409).json({ error: 'Item already owned' });
        }

        // Check balance
        const wallet = await db.query(
            'SELECT balance FROM player_wallets WHERE player_id = $1 AND tenant_id = $2 AND currency_type = $3',
            [playerId, tenantId, storeItem.currency_type]
        );

        const balance = wallet.rows[0] ? parseInt(wallet.rows[0].balance, 10) : 0;
        if (balance < storeItem.price) {
            return res.status(400).json({
                error: 'Insufficient balance',
                required: parseInt(storeItem.price, 10),
                current: balance
            });
        }

        // Debit wallet and add to inventory (transaction)
        await db.transaction(async (client) => {
            // Debit
            await client.query(`
                UPDATE player_wallets SET balance = balance - $1, updated_at = NOW()
                WHERE player_id = $2 AND tenant_id = $3 AND currency_type = $4
            `, [storeItem.price, playerId, tenantId, storeItem.currency_type]);

            // Log transaction
            const newBal = balance - parseInt(storeItem.price, 10);
            await client.query(`
                INSERT INTO economy_transactions (tenant_id, player_id, currency_type, amount, balance_after, tx_type, source, reference_id)
                VALUES ($1, $2, $3, $4, $5, 'spend', 'store', $6)
            `, [tenantId, playerId, storeItem.currency_type, -storeItem.price, newBal, itemId]);

            // Add to inventory
            await client.query(`
                INSERT INTO player_inventory (tenant_id, player_id, item_id, source)
                VALUES ($1, $2, $3, 'store')
            `, [tenantId, playerId, itemId]);
        });

        res.json({
            message: `Purchased ${storeItem.name}`,
            item: storeItem
        });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Inventory
// =========================================

router.get('/inventory', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;

        const result = await db.query(`
            SELECT pi.*, si.name, si.description, si.item_type, si.metadata
            FROM player_inventory pi
            JOIN store_items si ON si.id = pi.item_id
            WHERE pi.player_id = $1 AND pi.tenant_id = $2
            ORDER BY pi.acquired_at DESC
        `, [playerId, tenantId]);

        res.json({ inventory: result.rows });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Battle Pass: Info
// =========================================

router.get('/battlepass', async (req, res, next) => {
    try {
        const tenantId = req.player?.tenantId || 'stem_default';

        const result = await db.query(`
            SELECT bp.*, s.name as season_name, s.ends_at as season_ends_at
            FROM battle_passes bp
            LEFT JOIN seasons s ON s.id = bp.season_id
            WHERE bp.tenant_id = $1 AND bp.is_active = TRUE
            ORDER BY bp.created_at DESC LIMIT 1
        `, [tenantId]);

        if (result.rows.length === 0) {
            return res.json({ battlePass: null });
        }

        res.json({ battlePass: result.rows[0] });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Battle Pass: Player Progress
// =========================================

router.get('/battlepass/progress', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;

        // Get active battle pass
        const bp = await db.query(
            'SELECT id, max_tier, xp_per_tier, free_rewards, premium_rewards FROM battle_passes WHERE tenant_id = $1 AND is_active = TRUE LIMIT 1',
            [tenantId]
        );

        if (bp.rows.length === 0) {
            return res.json({ progress: null });
        }

        const battlePass = bp.rows[0];

        // Get or create player progress
        let progress = await db.query(
            'SELECT * FROM player_battle_pass WHERE player_id = $1 AND battle_pass_id = $2 AND tenant_id = $3',
            [playerId, battlePass.id, tenantId]
        );

        if (progress.rows.length === 0) {
            // Auto-create entry
            progress = await db.query(`
                INSERT INTO player_battle_pass (tenant_id, player_id, battle_pass_id)
                VALUES ($1, $2, $3)
                RETURNING *
            `, [tenantId, playerId, battlePass.id]);
        }

        const playerProgress = progress.rows[0];

        res.json({
            progress: {
                currentTier: playerProgress.current_tier,
                currentXp: playerProgress.current_xp,
                xpToNextTier: battlePass.xp_per_tier - playerProgress.current_xp,
                isPremium: playerProgress.is_premium,
                claimedTiers: playerProgress.claimed_tiers,
                maxTier: battlePass.max_tier,
                xpPerTier: battlePass.xp_per_tier,
                freeRewards: battlePass.free_rewards,
                premiumRewards: playerProgress.is_premium ? battlePass.premium_rewards : []
            }
        });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Battle Pass: Purchase Premium
// =========================================

router.post('/battlepass/purchase', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;

        const bp = await db.query(
            'SELECT id FROM battle_passes WHERE tenant_id = $1 AND is_active = TRUE LIMIT 1',
            [tenantId]
        );
        if (bp.rows.length === 0) {
            return res.status(404).json({ error: 'No active battle pass' });
        }

        const battlePassId = bp.rows[0].id;

        // Check if already premium
        const existing = await db.query(
            'SELECT is_premium FROM player_battle_pass WHERE player_id = $1 AND battle_pass_id = $2 AND tenant_id = $3',
            [playerId, battlePassId, tenantId]
        );

        if (existing.rows.length > 0 && existing.rows[0].is_premium) {
            return res.status(409).json({ error: 'Already have premium battle pass' });
        }

        // Debit gems (cost: 500 gems)
        const BP_COST = 500;
        const wallet = await db.query(
            'SELECT balance FROM player_wallets WHERE player_id = $1 AND tenant_id = $2 AND currency_type = $3',
            [playerId, tenantId, 'gems']
        );

        const balance = wallet.rows[0] ? parseInt(wallet.rows[0].balance, 10) : 0;
        if (balance < BP_COST) {
            return res.status(400).json({ error: 'Insufficient gems', required: BP_COST, current: balance });
        }

        await db.transaction(async (client) => {
            // Debit gems
            await client.query(
                'UPDATE player_wallets SET balance = balance - $1, updated_at = NOW() WHERE player_id = $2 AND tenant_id = $3 AND currency_type = $4',
                [BP_COST, playerId, tenantId, 'gems']
            );

            await client.query(`
                INSERT INTO economy_transactions (tenant_id, player_id, currency_type, amount, balance_after, tx_type, source, reference_id)
                VALUES ($1, $2, 'gems', $3, $4, 'spend', 'store', $5)
            `, [tenantId, playerId, -BP_COST, balance - BP_COST, 'battle_pass_premium']);

            // Upgrade to premium
            await client.query(`
                INSERT INTO player_battle_pass (tenant_id, player_id, battle_pass_id, is_premium, purchased_at)
                VALUES ($1, $2, $3, TRUE, NOW())
                ON CONFLICT (tenant_id, player_id, battle_pass_id)
                DO UPDATE SET is_premium = TRUE, purchased_at = NOW(), updated_at = NOW()
            `, [tenantId, playerId, battlePassId]);
        });

        res.json({ message: 'Premium battle pass activated' });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Battle Pass: Claim Tier Reward
// =========================================

router.post('/battlepass/claim', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const { tier } = req.body;

        if (tier === undefined || tier === null) {
            return res.status(400).json({ error: 'tier is required' });
        }

        // Get battle pass and player progress
        const bp = await db.query(
            'SELECT * FROM battle_passes WHERE tenant_id = $1 AND is_active = TRUE LIMIT 1',
            [tenantId]
        );
        if (bp.rows.length === 0) {
            return res.status(404).json({ error: 'No active battle pass' });
        }

        const battlePass = bp.rows[0];

        const progress = await db.query(
            'SELECT * FROM player_battle_pass WHERE player_id = $1 AND battle_pass_id = $2 AND tenant_id = $3',
            [playerId, battlePass.id, tenantId]
        );
        if (progress.rows.length === 0) {
            return res.status(404).json({ error: 'No battle pass progress' });
        }

        const playerProgress = progress.rows[0];

        // Validate tier is reached
        if (tier > playerProgress.current_tier) {
            return res.status(400).json({ error: 'Tier not yet reached' });
        }

        // Check not already claimed
        const claimed = playerProgress.claimed_tiers || [];
        if (claimed.includes(tier)) {
            return res.status(409).json({ error: 'Tier already claimed' });
        }

        // Find reward for this tier
        const freeRewards = battlePass.free_rewards || [];
        const premiumRewards = battlePass.premium_rewards || [];
        const freeReward = freeRewards.find(r => r.tier === tier);
        const premiumReward = playerProgress.is_premium ? premiumRewards.find(r => r.tier === tier) : null;

        const rewards = [];
        if (freeReward) rewards.push(freeReward);
        if (premiumReward) rewards.push(premiumReward);

        if (rewards.length === 0) {
            return res.status(404).json({ error: 'No reward at this tier' });
        }

        // Grant rewards
        for (const reward of rewards) {
            if (reward.reward_type === 'currency') {
                await _creditWallet(
                    tenantId, playerId,
                    reward.reward_data.currency_type || 'coins',
                    reward.reward_data.amount || 0,
                    'earn', 'battle_pass',
                    `bp_tier_${tier}`
                );
            } else if (reward.reward_type === 'item') {
                await db.query(`
                    INSERT INTO player_inventory (tenant_id, player_id, item_id, source)
                    VALUES ($1, $2, $3, 'battle_pass')
                    ON CONFLICT (tenant_id, player_id, item_id) DO NOTHING
                `, [tenantId, playerId, reward.reward_data.item_id]);
            }
        }

        // Update claimed tiers
        claimed.push(tier);
        await db.query(`
            UPDATE player_battle_pass SET claimed_tiers = $1, updated_at = NOW()
            WHERE player_id = $2 AND battle_pass_id = $3 AND tenant_id = $4
        `, [JSON.stringify(claimed), playerId, battlePass.id, tenantId]);

        res.json({ message: `Tier ${tier} rewards claimed`, rewards });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Battle Pass: Add XP (server-side)
// =========================================

router.post('/battlepass/xp', async (req, res, next) => {
    try {
        const playerId = req.player.id;
        const tenantId = req.player.tenantId;
        const { xp, source } = req.body;

        if (!xp || xp <= 0) {
            return res.status(400).json({ error: 'Positive XP amount required' });
        }

        const bp = await db.query(
            'SELECT id, max_tier, xp_per_tier FROM battle_passes WHERE tenant_id = $1 AND is_active = TRUE LIMIT 1',
            [tenantId]
        );
        if (bp.rows.length === 0) {
            return res.json({ message: 'No active battle pass', progress: null });
        }

        const battlePass = bp.rows[0];

        // Get or create progress
        let progress = await db.query(
            'SELECT * FROM player_battle_pass WHERE player_id = $1 AND battle_pass_id = $2 AND tenant_id = $3',
            [playerId, battlePass.id, tenantId]
        );

        if (progress.rows.length === 0) {
            progress = await db.query(`
                INSERT INTO player_battle_pass (tenant_id, player_id, battle_pass_id)
                VALUES ($1, $2, $3) RETURNING *
            `, [tenantId, playerId, battlePass.id]);
        }

        let { current_tier, current_xp } = progress.rows[0];
        let totalXp = current_xp + xp;
        let newTier = current_tier;

        // Level up
        while (totalXp >= battlePass.xp_per_tier && newTier < battlePass.max_tier) {
            totalXp -= battlePass.xp_per_tier;
            newTier++;
        }

        // Cap at max tier
        if (newTier >= battlePass.max_tier) {
            newTier = battlePass.max_tier;
            totalXp = 0;
        }

        await db.query(`
            UPDATE player_battle_pass
            SET current_tier = $1, current_xp = $2, updated_at = NOW()
            WHERE player_id = $3 AND battle_pass_id = $4 AND tenant_id = $5
        `, [newTier, totalXp, playerId, battlePass.id, tenantId]);

        res.json({
            progress: {
                previousTier: current_tier,
                currentTier: newTier,
                currentXp: totalXp,
                xpAwarded: xp,
                tiersGained: newTier - current_tier
            }
        });
    } catch (err) {
        next(err);
    }
});

// =========================================
// Helper: Credit Wallet
// =========================================

async function _creditWallet(tenantId, playerId, currencyType, amount, txType, source, referenceId) {
    // Upsert wallet
    const result = await db.query(`
        INSERT INTO player_wallets (tenant_id, player_id, currency_type, balance, lifetime_earned)
        VALUES ($1, $2, $3, $4, $4)
        ON CONFLICT (tenant_id, player_id, currency_type)
        DO UPDATE SET balance = player_wallets.balance + $4,
                      lifetime_earned = player_wallets.lifetime_earned + $4,
                      updated_at = NOW()
        RETURNING balance
    `, [tenantId, playerId, currencyType, amount]);

    const newBalance = parseInt(result.rows[0].balance, 10);

    // Log transaction
    await db.query(`
        INSERT INTO economy_transactions (tenant_id, player_id, currency_type, amount, balance_after, tx_type, source, reference_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [tenantId, playerId, currencyType, amount, newBalance, txType, source, referenceId || null]);

    return newBalance;
}

module.exports = router;
