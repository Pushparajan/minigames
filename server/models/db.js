/**
 * Database Connection Pool (PostgreSQL)
 * ======================================
 * Connection pooling for 1M+ player scale.
 * Uses pg Pool with configurable min/max connections.
 */

const { Pool } = require('pg');
const config = require('../config');

let pool = null;

function init() {
    pool = new Pool({
        host: config.db.host,
        port: config.db.port,
        database: config.db.database,
        user: config.db.user,
        password: config.db.password,
        min: config.db.pool.min,
        max: config.db.pool.max,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
    });

    pool.on('error', (err) => {
        console.error('Unexpected pool error:', err);
    });

    return pool.query('SELECT NOW()');
}

function query(text, params) {
    return pool.query(text, params);
}

async function transaction(callback) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

async function healthCheck() {
    try {
        await pool.query('SELECT 1');
        return true;
    } catch {
        return false;
    }
}

module.exports = { init, query, transaction, healthCheck };
