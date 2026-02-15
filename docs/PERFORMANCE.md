# Performance Optimization Guide

## Overview

Performance optimizations applied to the STEM School Adventures platform, covering game rendering, data structures, DOM manipulation, and resource management.

---

## Optimizations Applied

### 1. Per-Game Physics Engine Loading (Critical)

**Problem:** Phaser was loading both Matter.js AND Arcade physics for every game, even though only 1 of 25 games needs Matter.js.

**Solution:** Conditional physics config in `Launcher.js` based on the `game.physics` registration property.

- Only `PhysicsMasterBilliards` specifies `physics: 'matter'`
- All other 24 games load with no physics engine overhead
- Saves ~200KB of JavaScript parsing and initialization per game launch

**Before:**

```javascript
// Every game loaded with full physics regardless of need
const config = {
    type: Phaser.AUTO,
    physics: {
        default: 'arcade',
        arcade: { gravity: { y: 0 } },
        matter: { gravity: { y: 1 } }
    }
};
```

**After:**

```javascript
// Physics config determined per game at launch
const physicsConfig = game.physics === 'matter'
    ? { default: 'matter', matter: { gravity: { y: 1 } } }
    : { default: 'arcade', arcade: { gravity: { y: 0 } } };

const config = {
    type: Phaser.AUTO,
    physics: physicsConfig
};
```

---

### 2. Binary Search Terrain Lookup (High Impact)

**Problem:** `RoverFieldTest` and `HeavyGearDelivery` used O(n) linear scan through 500+ terrain points, called multiple times per frame.

**Solution:** Replaced with O(log n) binary search.

| Metric            | Linear Scan | Binary Search |
| ----------------- | ----------- | ------------- |
| Iterations/lookup | ~500        | ~9            |
| Complexity        | O(n)        | O(log n)      |
| Method            | `_getTerrainYAt(worldX)` | `_getTerrainYAt(worldX)` |

**Before:**

```javascript
_getTerrainYAt(worldX) {
    for (let i = 0; i < this.terrainPoints.length - 1; i++) {
        if (worldX >= this.terrainPoints[i].x && worldX < this.terrainPoints[i + 1].x) {
            const t = (worldX - this.terrainPoints[i].x) /
                      (this.terrainPoints[i + 1].x - this.terrainPoints[i].x);
            return this.terrainPoints[i].y + t * (this.terrainPoints[i + 1].y - this.terrainPoints[i].y);
        }
    }
}
```

**After:**

```javascript
_getTerrainYAt(worldX) {
    let lo = 0, hi = this.terrainPoints.length - 2;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.terrainPoints[mid + 1].x <= worldX) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    const p0 = this.terrainPoints[lo];
    const p1 = this.terrainPoints[lo + 1];
    const t = (worldX - p0.x) / (p1.x - p0.x);
    return p0.y + t * (p1.y - p0.y);
}
```

---

### 3. Throttled Score DOM Updates (Moderate Impact)

**Problem:** `CampusDash`, `ParkourLab`, `RoverFieldTest`, and `HeavyGearDelivery` called `Launcher.updateScore()` every frame, triggering DOM manipulation 60 times per second.

**Solution:** Only call `Launcher.updateScore()` when the score actually changes.

**Before:**

```javascript
update() {
    this.score = Math.floor(this.distance);
    Launcher.updateScore(this.score);  // Called 60 times/second regardless
}
```

**After:**

```javascript
update() {
    const newScore = Math.floor(this.distance);
    if (newScore !== this.score) {
        this.score = newScore;
        Launcher.updateScore(this.score);  // Called only on change
    }
}
```

---

### 4. Static Background Rendering (Moderate Impact)

**Problem:** `AeroEngineering` was clearing and redrawing its solid sky background every frame.

**Solution:** Draw static backgrounds once in `create()`, only redraw dynamic elements in `update()`.

**Before:**

```javascript
update() {
    this.graphics.clear();
    // Redraw sky gradient every frame
    this.graphics.fillStyle(0x87CEEB);
    this.graphics.fillRect(0, 0, 800, 600);
    // Then draw dynamic elements...
}
```

**After:**

```javascript
create() {
    // Draw static background once
    this.bgGraphics = this.add.graphics();
    this.bgGraphics.fillStyle(0x87CEEB);
    this.bgGraphics.fillRect(0, 0, 800, 600);
    this.bgGraphics.setDepth(0);

    // Separate graphics object for dynamic elements
    this.dynamicGraphics = this.add.graphics();
    this.dynamicGraphics.setDepth(1);
}

update() {
    this.dynamicGraphics.clear();
    // Only redraw dynamic elements
}
```

---

### 5. Phaser Time Consistency (Low Impact)

**Problem:** `DroneDefense` used `Date.now()` for enemy oscillation, which is not synchronized with Phaser's internal clock.

**Solution:** Replaced with `this.time.now` for consistent frame timing.

**Before:**

```javascript
update() {
    enemy.y = enemy.baseY + Math.sin(Date.now() * 0.002) * 30;
}
```

**After:**

```javascript
update() {
    enemy.y = enemy.baseY + Math.sin(this.time.now * 0.002) * 30;
}
```

---

### 6. Scene Lifecycle Cleanup (Memory)

**Problem:** Game scenes did not clean up arrays (bullets, enemies, particles) when switching games, causing memory leaks over time.

**Solution:** Added `shutdown()` methods to all 25 game scenes that reset entity arrays.

```javascript
shutdown() {
    this.bullets = [];
    this.enemies = [];
    this.particles = [];
    this.powerUps = [];
}

create() {
    // Register cleanup on scene shutdown
    this.events.on('shutdown', this.shutdown, this);
}
```

---

## Performance Patterns

### Graphics Rendering

- Use `graphics.clear()` only on dynamic layers
- Static backgrounds: draw once in `create()`
- Use `.setDepth()` for z-ordering instead of draw-order hacks
- Minimize the number of graphics objects per scene

### Entity Management

- Iterate arrays in reverse when using `splice()` for safe removal:

```javascript
for (let i = this.bullets.length - 1; i >= 0; i--) {
    if (this.bullets[i].life <= 0) {
        this.bullets.splice(i, 1);
    }
}
```

- Set entity `life` counters to auto-expire
- Limit particle count (6-8 per explosion)
- Use short particle lifetimes (20-25 frames)

### Collision Detection

- Simple distance checks using squared distance to avoid `Math.sqrt`:

```javascript
const dx = a.x - b.x;
const dy = a.y - b.y;
const distSq = dx * dx + dy * dy;
if (distSq < radiusSq) { /* collision */ }
```

- Skip off-screen entities before collision checks
- Break out of inner loop after first hit when applicable

### Data Structures

- Binary search for sorted arrays (terrain points, waypoints, etc.)
- Hash maps for O(1) lookups where applicable
- Sharded Redis sorted sets for leaderboards (see Backend Performance below)

### DOM Interaction

- Only update DOM text when values change
- Batch DOM reads/writes to avoid layout thrashing
- Use CSS transforms for animations instead of layout properties

---

## Backend Performance

### Rust (Axum) Backend

The backend is built in Rust using Axum 0.7 with Tokio async runtime, hosted on Shuttle.dev as a persistent process. Key performance characteristics:

- **Zero-cost abstractions**: Rust's ownership model eliminates garbage collection pauses
- **Async I/O**: Tokio runtime for non-blocking database and Redis operations via SQLx
- **Persistent process**: Hosted on Shuttle.dev as an always-on server -- no cold starts, connection pools stay warm, WebSocket connections are native
- **Tower middleware**: Composable, zero-overhead middleware stack for auth, rate limiting, and tenant resolution

### Leaderboard Sharding

Leaderboards use sharded Redis sorted sets to distribute load:

- **8 Redis sorted sets** per game per tenant
- Player assigned to shard via `hash(playerId) % SHARD_COUNT`
- Top-K merge across shards: O(K x SHARD_COUNT)
- 30-second result cache, 2-hour sorted set TTL

```
Key format: lb:{tenantId}:{gameId}:shard:{0..7}
```

### Database

- Partitioned `score_history` table by month for efficient pruning
- Connection pooling via SQLx: 5-50 connections (scales with load)
- Composite indexes for leaderboard queries
- Connection pools stay warm on Shuttle (persistent process, no cold starts)

### Caching

| Cache Layer         | TTL    | Purpose                          |
| ------------------- | ------ | -------------------------------- |
| Entitlement cache   | 120s   | Avoid repeated license checks    |
| Leaderboard results | 30s    | Reduce Redis merge frequency     |
| Redis sorted sets   | 2h     | Auto-expire stale leaderboards   |

### API

- gzip compression via tower-http for all responses
- Rate limiting: 100 req/min global, 30/min for score submission
- Batch sync endpoint: max 50 operations per request

---

## Monitoring

| Endpoint             | Description                                          |
| -------------------- | ---------------------------------------------------- |
| `/api/v1/health`     | Health check                                         |
| `/api/v1/metrics`    | Request counts, WebSocket connections, matchmaking queue |

---

## Browser Targets

| Browser    | Version | Notes                       |
| ---------- | ------- | --------------------------- |
| Chrome     | 90+     | Primary target, WebGL       |
| Firefox    | 90+     | Supported                   |
| Safari     | 15+     | Supported                   |
| Edge       | 90+     | Supported                   |
| Older      | -       | Canvas fallback             |

---

## Future Optimizations (Not Yet Implemented)

These optimizations have been identified but are not yet applied:

1. **Object pooling for bullets/particles** - Reuse entity objects instead of create/destroy cycles to reduce garbage collection pressure.
2. **Web Workers for heavy calculations** - Offload terrain generation or pathfinding to background threads.
3. **Texture atlases for character sprites** - Combine multiple sprite images into single atlas sheets to reduce draw calls and HTTP requests.
4. **requestAnimationFrame throttling for background tabs** - Reduce or pause game loop when the browser tab is not visible to save CPU and battery.
