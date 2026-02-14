/**
 * Performance Monitoring Middleware
 * ==================================
 * Collects and exposes metrics for observability.
 * Compatible with Prometheus/Grafana and Datadog.
 *
 * Tracks:
 *   - Request latency (avg, p95, p99)
 *   - Concurrent connected users (CCU)
 *   - Active game rooms
 *   - Error rates
 *   - Endpoint-level stats
 *   - WebSocket connection counts
 */

const os = require('os');

// In-memory metrics store
const _metrics = {
    requests: {
        total: 0,
        errors: 0,
        latencies: [],  // Ring buffer
        byEndpoint: {}  // path -> { count, totalMs, errors }
    },
    ccu: 0,
    peakCcu: 0,
    wsConnections: 0,
    activeRooms: 0,
    matchmakingQueue: 0,
    startedAt: Date.now(),
    nodeId: process.env.NODE_ID || `node-${process.pid}`
};

const LATENCY_BUFFER_SIZE = 1000;

/**
 * Express middleware to track request metrics.
 */
function requestTracker(req, res, next) {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
        const durationNs = Number(process.hrtime.bigint() - start);
        const durationMs = durationNs / 1e6;

        _metrics.requests.total++;

        // Track latency in ring buffer
        _metrics.requests.latencies.push(durationMs);
        if (_metrics.requests.latencies.length > LATENCY_BUFFER_SIZE) {
            _metrics.requests.latencies.shift();
        }

        // Track errors
        if (res.statusCode >= 500) {
            _metrics.requests.errors++;
        }

        // Per-endpoint tracking
        const route = req.route?.path || req.path;
        const key = `${req.method} ${route}`;
        if (!_metrics.requests.byEndpoint[key]) {
            _metrics.requests.byEndpoint[key] = { count: 0, totalMs: 0, errors: 0 };
        }
        const ep = _metrics.requests.byEndpoint[key];
        ep.count++;
        ep.totalMs += durationMs;
        if (res.statusCode >= 500) ep.errors++;
    });

    next();
}

/**
 * Update CCU count.
 */
function setCcu(count) {
    _metrics.ccu = count;
    if (count > _metrics.peakCcu) _metrics.peakCcu = count;
}

/**
 * Update WebSocket connection count.
 */
function setWsConnections(count) {
    _metrics.wsConnections = count;
}

/**
 * Update active room count.
 */
function setActiveRooms(count) {
    _metrics.activeRooms = count;
}

/**
 * Update matchmaking queue size.
 */
function setMatchmakingQueue(count) {
    _metrics.matchmakingQueue = count;
}

/**
 * Calculate percentile from sorted array.
 */
function _percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil(sorted.length * p / 100) - 1;
    return sorted[Math.max(0, idx)];
}

/**
 * Get current metrics snapshot.
 */
function getMetrics() {
    const latencies = [..._metrics.requests.latencies].sort((a, b) => a - b);
    const avgLatency = latencies.length > 0
        ? latencies.reduce((s, v) => s + v, 0) / latencies.length
        : 0;

    return {
        nodeId: _metrics.nodeId,
        uptime: Date.now() - _metrics.startedAt,
        system: {
            memoryMb: Math.round(process.memoryUsage().rss / 1048576 * 10) / 10,
            cpuPercent: _getCpuPercent(),
            loadAvg: os.loadavg()
        },
        connections: {
            ccu: _metrics.ccu,
            peakCcu: _metrics.peakCcu,
            wsConnections: _metrics.wsConnections
        },
        game: {
            activeRooms: _metrics.activeRooms,
            matchmakingQueue: _metrics.matchmakingQueue
        },
        http: {
            totalRequests: _metrics.requests.total,
            totalErrors: _metrics.requests.errors,
            errorRate: _metrics.requests.total > 0
                ? Math.round(_metrics.requests.errors / _metrics.requests.total * 10000) / 100
                : 0,
            latency: {
                avg: Math.round(avgLatency * 100) / 100,
                p50: Math.round(_percentile(latencies, 50) * 100) / 100,
                p95: Math.round(_percentile(latencies, 95) * 100) / 100,
                p99: Math.round(_percentile(latencies, 99) * 100) / 100
            }
        },
        endpoints: _getTopEndpoints(10)
    };
}

/**
 * Get Prometheus-compatible text output.
 */
function getPrometheusMetrics() {
    const m = getMetrics();
    const lines = [];
    const prefix = 'stem_';

    lines.push(`# HELP ${prefix}ccu Current concurrent users`);
    lines.push(`# TYPE ${prefix}ccu gauge`);
    lines.push(`${prefix}ccu{node="${m.nodeId}"} ${m.connections.ccu}`);

    lines.push(`# HELP ${prefix}ws_connections Active WebSocket connections`);
    lines.push(`# TYPE ${prefix}ws_connections gauge`);
    lines.push(`${prefix}ws_connections{node="${m.nodeId}"} ${m.connections.wsConnections}`);

    lines.push(`# HELP ${prefix}active_rooms Active game rooms`);
    lines.push(`# TYPE ${prefix}active_rooms gauge`);
    lines.push(`${prefix}active_rooms{node="${m.nodeId}"} ${m.game.activeRooms}`);

    lines.push(`# HELP ${prefix}http_requests_total Total HTTP requests`);
    lines.push(`# TYPE ${prefix}http_requests_total counter`);
    lines.push(`${prefix}http_requests_total{node="${m.nodeId}"} ${m.http.totalRequests}`);

    lines.push(`# HELP ${prefix}http_errors_total Total HTTP errors`);
    lines.push(`# TYPE ${prefix}http_errors_total counter`);
    lines.push(`${prefix}http_errors_total{node="${m.nodeId}"} ${m.http.totalErrors}`);

    lines.push(`# HELP ${prefix}http_latency_ms HTTP latency in milliseconds`);
    lines.push(`# TYPE ${prefix}http_latency_ms summary`);
    lines.push(`${prefix}http_latency_ms{node="${m.nodeId}",quantile="0.5"} ${m.http.latency.p50}`);
    lines.push(`${prefix}http_latency_ms{node="${m.nodeId}",quantile="0.95"} ${m.http.latency.p95}`);
    lines.push(`${prefix}http_latency_ms{node="${m.nodeId}",quantile="0.99"} ${m.http.latency.p99}`);

    lines.push(`# HELP ${prefix}memory_mb Process memory in MB`);
    lines.push(`# TYPE ${prefix}memory_mb gauge`);
    lines.push(`${prefix}memory_mb{node="${m.nodeId}"} ${m.system.memoryMb}`);

    lines.push(`# HELP ${prefix}matchmaking_queue Players in matchmaking queue`);
    lines.push(`# TYPE ${prefix}matchmaking_queue gauge`);
    lines.push(`${prefix}matchmaking_queue{node="${m.nodeId}"} ${m.game.matchmakingQueue}`);

    return lines.join('\n') + '\n';
}

/**
 * Get top N endpoints by request count.
 */
function _getTopEndpoints(n) {
    return Object.entries(_metrics.requests.byEndpoint)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, n)
        .map(([path, stats]) => ({
            path,
            count: stats.count,
            avgMs: Math.round(stats.totalMs / stats.count * 100) / 100,
            errors: stats.errors
        }));
}

/**
 * Approximate CPU usage.
 */
let _lastCpuUsage = process.cpuUsage();
let _lastCpuTime = Date.now();

function _getCpuPercent() {
    const now = Date.now();
    const elapsed = (now - _lastCpuTime) * 1000; // microseconds
    const usage = process.cpuUsage(_lastCpuUsage);
    _lastCpuUsage = process.cpuUsage();
    _lastCpuTime = now;
    if (elapsed === 0) return 0;
    return Math.round((usage.user + usage.system) / elapsed * 100 * 10) / 10;
}

/**
 * Metrics API route handler — GET /metrics
 */
function metricsEndpoint(req, res) {
    const accept = req.headers.accept || '';
    if (accept.includes('text/plain') || req.query.format === 'prometheus') {
        res.set('Content-Type', 'text/plain; charset=utf-8');
        return res.send(getPrometheusMetrics());
    }
    res.json(getMetrics());
}

/**
 * Health check endpoint — GET /health
 */
function healthEndpoint(req, res) {
    res.json({
        status: 'ok',
        nodeId: _metrics.nodeId,
        uptime: Date.now() - _metrics.startedAt,
        ccu: _metrics.ccu,
        memoryMb: Math.round(process.memoryUsage().rss / 1048576 * 10) / 10
    });
}

module.exports = {
    requestTracker,
    setCcu,
    setWsConnections,
    setActiveRooms,
    setMatchmakingQueue,
    getMetrics,
    getPrometheusMetrics,
    metricsEndpoint,
    healthEndpoint
};
