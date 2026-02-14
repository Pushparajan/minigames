/**
 * Database Seeder
 * ================
 * Seeds development data for testing.
 * Usage: node db/seeds/run.js
 */

const path = require('path');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

require('dotenv').config({ path: path.join(__dirname, '../../server/.env') });
const config = require('../../server/config');

const GAMES = [
    'PhysicsMasterBilliards', 'STEMProjectVolley', 'LogicronsGridShift',
    'DroneDefense', 'LabBreach', 'GeologyDeepDive', 'CampusDash',
    'SafetyFirstDefense', 'GravityShiftRun', 'DemoDay', 'ChemistryEscape',
    'RoverFieldTest', 'HydroLogicPuzzles', 'ColorLabQuest', 'CableCarConundrum',
    'FindThePrincipal', 'FormulaSTEM', 'CampusGuard', 'HistoryVaultEscape',
    'MolecularSplit', 'HeavyGearDelivery', 'AeroEngineering', 'RobotRepairBay',
    'ParkourLab', 'STEMCelebration'
];

const NAMES = [
    'Alex Explorer', 'Jordan Maker', 'Sam Builder', 'Riley Thinker',
    'Casey Scientist', 'Morgan Creator', 'Taylor Inventor', 'Quinn Dreamer',
    'Avery Solver', 'Parker Coder'
];

const AVATARS = ['guha', 'nadia', 'sofia', 'maya', 'zack', 'pancho'];

async function seed() {
    const pool = new Pool({
        host: config.db.host,
        port: config.db.port,
        database: config.db.database,
        user: config.db.user,
        password: config.db.password
    });

    try {
        const tenantId = 'stem_default';

        console.log('Seeding test players...');
        const playerIds = [];

        for (let i = 0; i < 100; i++) {
            const id = uuidv4();
            const name = `${NAMES[i % NAMES.length]} ${i + 1}`;
            const avatar = AVATARS[i % AVATARS.length];

            await pool.query(`
                INSERT INTO players (id, tenant_id, display_name, avatar_character, is_guest, total_score, games_played)
                VALUES ($1, $2, $3, $4, true, 0, 0)
                ON CONFLICT DO NOTHING
            `, [id, tenantId, name, avatar]);

            playerIds.push(id);
        }

        console.log(`  Created ${playerIds.length} test players`);

        console.log('Seeding game scores...');
        let scoreCount = 0;

        for (const playerId of playerIds) {
            // Each player plays 3-10 random games
            const gamesPlayed = 3 + Math.floor(Math.random() * 8);
            const shuffled = [...GAMES].sort(() => Math.random() - 0.5);
            let totalScore = 0;

            for (let g = 0; g < gamesPlayed; g++) {
                const gameId = shuffled[g];
                const score = 50 + Math.floor(Math.random() * 2000);
                const stars = score > 1000 ? 3 : score > 500 ? 2 : score > 100 ? 1 : 0;
                totalScore += score;

                await pool.query(`
                    INSERT INTO game_progress (player_id, tenant_id, game_id, high_score, stars, level, play_count, total_score, last_played_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $4, NOW() - interval '1 day' * $8)
                    ON CONFLICT (player_id, tenant_id, game_id) DO NOTHING
                `, [playerId, tenantId, gameId, score, stars,
                    1 + Math.floor(Math.random() * 5),
                    1 + Math.floor(Math.random() * 20),
                    Math.floor(Math.random() * 30)]);

                scoreCount++;
            }

            // Update player total
            await pool.query(
                'UPDATE players SET total_score = $1, games_played = $2 WHERE id = $3 AND tenant_id = $4',
                [totalScore, gamesPlayed, playerId, tenantId]
            );
        }

        console.log(`  Seeded ${scoreCount} game progress entries`);
        console.log('Seed complete!');
    } finally {
        await pool.end();
    }
}

seed().catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
});
