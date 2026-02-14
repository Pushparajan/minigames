/**
 * Migration Runner
 * =================
 * Runs SQL migration files in order against PostgreSQL.
 * Usage: node db/migrations/run.js
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '../../server/.env') });

const config = require('../../server/config');

async function run() {
    const pool = new Pool({
        host: config.db.host,
        port: config.db.port,
        database: config.db.database,
        user: config.db.user,
        password: config.db.password
    });

    try {
        // Create migrations tracking table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS _migrations (
                id SERIAL PRIMARY KEY,
                filename VARCHAR(255) UNIQUE NOT NULL,
                applied_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        // Get already applied migrations
        const applied = await pool.query('SELECT filename FROM _migrations ORDER BY id');
        const appliedSet = new Set(applied.rows.map(r => r.filename));

        // Read migration files
        const migrationsDir = __dirname;
        const files = fs.readdirSync(migrationsDir)
            .filter(f => f.endsWith('.sql'))
            .sort();

        let count = 0;
        for (const file of files) {
            if (appliedSet.has(file)) {
                console.log(`  Skip: ${file} (already applied)`);
                continue;
            }

            const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
            console.log(`  Apply: ${file}...`);

            await pool.query('BEGIN');
            try {
                await pool.query(sql);
                await pool.query(
                    'INSERT INTO _migrations (filename) VALUES ($1)',
                    [file]
                );
                await pool.query('COMMIT');
                count++;
                console.log(`  Done: ${file}`);
            } catch (err) {
                await pool.query('ROLLBACK');
                console.error(`  FAILED: ${file}`, err.message);
                throw err;
            }
        }

        console.log(`\nMigrations complete. ${count} applied.`);
    } finally {
        await pool.end();
    }
}

run().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
