/**
 * Redis Cache Service
 * ====================
 * High-performance caching layer for leaderboards, sessions,
 * and frequently accessed data. Designed for 1M+ concurrent players.
 */

const { createClient } = require('redis');
const config = require('../config');

let client = null;

async function init() {
    client = createClient({
        socket: {
            host: config.redis.host,
            port: config.redis.port
        },
        password: config.redis.password || undefined,
        database: config.redis.db
    });

    client.on('error', (err) => {
        console.error('Redis error:', err.message);
    });

    await client.connect();
    console.log('Redis: Connected');
}

function _key(key) {
    return config.redis.keyPrefix + key;
}

async function get(key) {
    const val = await client.get(_key(key));
    return val ? JSON.parse(val) : null;
}

async function set(key, value, ttlSeconds = 300) {
    await client.set(_key(key), JSON.stringify(value), { EX: ttlSeconds });
}

async function del(key) {
    await client.del(_key(key));
}

/**
 * Sorted set operations for leaderboards.
 */
async function zadd(key, score, member) {
    await client.zAdd(_key(key), { score, value: member });
}

async function zrevrange(key, start, stop, withScores = true) {
    if (withScores) {
        return client.zRangeWithScores(_key(key), start, stop, { REV: true });
    }
    return client.zRange(_key(key), start, stop, { REV: true });
}

async function zrevrank(key, member) {
    return client.zRevRank(_key(key));
}

async function zscore(key, member) {
    return client.zScore(_key(key), member);
}

async function zcard(key) {
    return client.zCard(_key(key));
}

async function incr(key) {
    return client.incr(_key(key));
}

async function expire(key, seconds) {
    return client.expire(_key(key), seconds);
}

async function healthCheck() {
    try {
        await client.ping();
        return true;
    } catch {
        return false;
    }
}

module.exports = {
    init, get, set, del,
    zadd, zrevrange, zrevrank, zscore, zcard,
    incr, expire, healthCheck
};
