# STEM School Adventures - Architecture

## Table of Contents

- [System Overview](#system-overview)
- [High-Level Architecture](#high-level-architecture)
- [Frontend Architecture](#frontend-architecture)
- [Backend Architecture](#backend-architecture)
- [Database Schema](#database-schema)
- [Multi-Tenant Architecture](#multi-tenant-architecture)
- [Multiplayer System](#multiplayer-system)
- [Authentication Flow](#authentication-flow)
- [Billing Flow](#billing-flow)
- [Data Flow: Score Submission](#data-flow-score-submission)
- [Caching Strategy](#caching-strategy)
- [Deployment](#deployment)
- [Scalability](#scalability)

---

## System Overview

STEM School Adventures is a multi-tenant STEM gaming platform designed for schools and educational organisations. The platform delivers 25 browser-based educational minigames spanning physics, chemistry, engineering, biology, and computer science.

**Core technology stack:**

| Layer           | Technology                              |
|-----------------|-----------------------------------------|
| UI / Menu       | React (Vite + TypeScript)               |
| Game Engine     | Bevy 0.15 (Rust → WASM, WebGL2)        |
| Backend API     | Rust (Axum 0.7, Tower, Tokio)           |
| Database        | PostgreSQL (SQLx async driver)          |
| Cache           | Redis                                   |
| Billing         | Stripe (subscriptions + webhooks)       |
| Realtime        | WebSocket                               |
| Hosting (API)   | Shuttle.dev (persistent Rust process)   |
| Hosting (UI)    | Vercel (static React build)             |

---

## High-Level Architecture

```
+------------------------------------------------------------------+
|                        Browser Client                            |
|                                                                  |
|  +---------------------------+   +----------------------------+  |
|  |   Bevy Game Engine        |   |      React UI (Vite)       |  |
|  |   (Rust → WASM, WebGL2)   |   |  (auth, billing, lobby,   |  |
|  |   renders to <canvas>     |   |   game grid, admin)        |  |
|  +---------------------------+   +----------------------------+  |
|         |          |                     |           |           |
|    wasm-bindgen    |                localStorage     |           |
|    JS bridge       |                (offline-first)  |           |
+------------------------------------------------------------------+
          |          |                     |           |
     Score events  WebSocket           REST API     REST API
     (via bridge)   (WSS)             (HTTPS)      (HTTPS)
          |          |                     |           |
+------------------------------------------------------------------+
|            Rust (Axum) Server on Shuttle.dev                     |
|                                                                  |
|  +------------+  +-------------+  +------------+  +-----------+  |
|  |  REST API  |  |  WebSocket  |  | Middleware  |  | Services  |  |
|  | (18 route  |  |   Server    |  |  (Tower)    |  | (Stripe,  |  |
|  |  modules)  |  | (persistent |  | (auth, rate |  |  leaderb, |  |
|  |            |  |  on Shuttle)|  |  limit, etc)|  |  cache)   |  |
|  +------------+  +-------------+  +------------+  +-----------+  |
|         |                |               |              |        |
+------------------------------------------------------------------+
          |                |               |              |
          v                |               v              v
  +---------------+        |       +---------------+  +---------+
  |  PostgreSQL   |        |       |     Redis     |  | Stripe  |
  |  (Neon /      |        |       |  (Upstash /   |  |  API    |
  |   Supabase)   |        |       |   Vercel KV)  |  |         |
  |               |        |       |               |  |         |
  | - tenants     |        |       | - leaderboard |  | - subs  |
  | - players     |        |       |   sorted sets |  | - plans |
  | - scores      |        |       | - entitlement |  | - hooks |
  | - billing     |        |       |   cache       |  |         |
  | - social      |        |       | - session     |  |         |
  | - multiplayer |        |       |   data        |  |         |
  +---------------+        |       +---------------+  +---------+
                           |
                    WebSocket (WSS)
                           |
                   +---------------+
                   |  Other        |
                   |  Clients      |
                   |  (multiplayer |
                   |   opponents)  |
                   +---------------+
```

---

## Frontend Architecture

The frontend is a single-page application composed of a Phaser 3 game engine for minigames and vanilla JavaScript modules for platform UI (authentication, billing, administration).

### Directory Structure

```
js/
  engine/           # Core engine modules (7 files)
    GameRegistry.js
    Launcher.js
    SaveManager.js
    CloudSyncAPI.js
    BootScene.js
    MultiplayerClient.js
    CharacterFactory.js
  games/            # 25 Phaser Scene classes
  site-ui.js        # Auth modals, billing, navigation
  lobby-ui.js       # Multiplayer lobby and chat
  admin-games.js    # Admin panel for game/category CRUD
```

### Game Engine (`js/engine/`)

The engine layer consists of seven modules that manage game lifecycle, persistence, networking, and rendering.

#### GameRegistry

Central registry for all playable games. Supports both built-in games (statically registered) and custom games loaded dynamically from the API.

- Custom games are evaluated at runtime via `new Function()` to instantiate Phaser Scene classes from server-stored code.
- Games are organized into categories with a reverse mapping for efficient lookup (game ID to category).
- Provides the data source for the launcher grid and filtering UI.

#### Launcher

Manages the game selection grid and Phaser instance lifecycle.

- Renders a responsive grid of available games with category filtering.
- Creates and destroys Phaser game instances per play session to avoid memory leaks.
- Configures per-game physics:
  - **Matter.js** physics enabled for billiards-style games.
  - **No physics engine** for all other games (scenes handle their own logic).
- Provides `updateScore()` and `saveGameScore()` as the interface for scenes to report results.

#### SaveManager

Offline-first persistence layer using `localStorage` with cloud sync queuing.

```
localStorage Keys:
  stem_adventures_player     # Player profile and auth state
  stem_adventures_progress   # Per-game scores, stars, play counts
  stem_adventures_settings   # User preferences
  stem_adventures_sync_queue # Pending server syncs (offline queue)
```

- Calculates star ratings (1-3 stars) using per-game score thresholds.
- Maintains a sync queue that buffers writes when offline and retries on reconnect.
- Supports full state export and import for data portability.

#### CloudSyncAPI

Handles background synchronisation between local state and the server.

- Runs on a **30-second sync interval**.
- Processes queued updates in **batches of up to 20** per cycle.
- Uses **exponential backoff** on failure to avoid overwhelming the server.
- Monitors `navigator.onLine` for online/offline transitions and triggers immediate sync on reconnection.

#### BootScene

Universal Phaser preload scene that runs before any game scene.

- Loads shared assets (character sprites, common UI elements).
- Provides a loading progress bar.
- Transitions to the requested game scene once loading completes.

#### MultiplayerClient

WebSocket client for real-time multiplayer gameplay.

```
Client Architecture:
  +------------------+
  | Game Scene       |  Sends inputs (sequenced)
  +--------+---------+
           |
  +--------v---------+
  | MultiplayerClient|  Client-side prediction
  |                  |  State interpolation
  |  - Input buffer  |  RTT tracking
  |  - State history |  Auto-reconnect
  +--------+---------+
           |
     WebSocket (WSS)
           |
  +--------v---------+
  | Server           |  Authoritative state
  +------------------+
```

- Assigns **sequence numbers** to all outgoing inputs for server reconciliation.
- Performs **client-side prediction** to mask network latency.
- Tracks **round-trip time (RTT)** for latency display and interpolation tuning.
- Interpolates between received server states for smooth rendering.
- Auto-reconnects on disconnect with a **maximum of 5 attempts** using backoff.

#### CharacterFactory

Renders player character sprites from SVG definitions.

- Supports **12 distinct characters** with unique colour palettes and features.
- Generates sprites programmatically (no external sprite sheet files).
- Used in both game scenes and UI avatars.

### UI Modules

| Module           | Responsibility                                                  |
|------------------|-----------------------------------------------------------------|
| `site-ui.js`     | Authentication modals (login, register, guest), billing portal, navigation state management |
| `lobby-ui.js`    | Multiplayer lobby UI, room creation/joining, in-lobby chat      |
| `admin-games.js` | Admin panel for CRUD operations on games and categories         |

### Game Scenes (`js/games/`)

25 Phaser Scene classes implementing individual minigames across five STEM disciplines.

**Common patterns across all scenes:**

- All extend `Phaser.Scene` directly.
- Use **graphics-based rendering** (procedural drawing) rather than external sprite sheets, keeping the deployment footprint minimal.
- Implement `shutdown()` methods for clean resource disposal when the scene is stopped.
- Report scores through `Launcher.updateScore()` (live UI update) and `Launcher.saveGameScore()` (persistence trigger).

---

## Backend Architecture

### Server Entry Point (`server-rs/src/main.rs`)

The Rust server uses Axum 0.7 with Tower middleware layers. Application state (database pool, Redis cache, Stripe client, configuration) is initialized lazily via `OnceCell` for fast serverless cold starts. The middleware stack is applied in order via Tower's `ServiceBuilder`.

```
Request Lifecycle:

  Incoming Request (via vercel_runtime handler)
       |
       v
  [1] CORS (Tower layer)
       |
       v
  [2] Compression (tower-http)
       |
       v
  [3] Rate Limiter (per-IP, Tower layer)
       |
       v
  [4] Tenant Resolver (API key or JWT → tenant context)
       |
       v
  [5] Locale Detector (Accept-Language)
       |
       v
  Route Handler → Service Layer → Database (SQLx) / Redis / Stripe
       |
       v
  [Error Handler] (custom AppError → JSON response)
```

Stripe webhook routes handle raw body verification internally using HMAC signature validation.

### Route Modules

All routes are prefixed under `/api/v1/`. The platform exposes 18 route modules:

| Route Module     | Path Prefix               | Purpose                                      |
|------------------|---------------------------|----------------------------------------------|
| `auth`           | `/api/v1/auth`            | Registration, login, guest tokens, refresh    |
| `scores`         | `/api/v1/scores`          | Score submission and retrieval                |
| `leaderboards`   | `/api/v1/leaderboards`    | Global and per-game leaderboard queries       |
| `player`         | `/api/v1/player`          | Player profile management                    |
| `sync`           | `/api/v1/sync`            | Batch cloud sync for offline-queued data      |
| `billing`        | `/api/v1/billing`         | Subscription management, portal, checkout     |
| `organisations`  | `/api/v1/organisations`   | Team/school workspace management              |
| `comments`       | `/api/v1/comments`        | Game reviews and comments                     |
| `admin`          | `/api/v1/admin`           | Platform administration                       |
| `multiplayer`    | `/api/v1/multiplayer`     | Match history, stats                          |
| `games`          | `/api/v1/games`           | Game registry and custom game management      |
| `friends`        | `/api/v1/friends`         | Friend requests and social graph              |
| `economy`        | `/api/v1/economy`         | Virtual currency and rewards                  |
| `presence`       | `/api/v1/presence`        | Online status tracking                        |
| `compliance`     | `/api/v1/compliance`      | COPPA/GDPR compliance endpoints               |
| `webhooks`       | `/api/v1/webhooks`        | Stripe webhook ingestion                      |

### Middleware

#### Rate Limiter (`middleware/rate_limit.rs`)

Two tiers of rate limiting protect the API:

| Scope             | Limit         | Window  |
|-------------------|---------------|---------|
| Global (all routes) | 100 requests | 1 minute |
| Score submission  | 30 requests   | 1 minute |

#### Tenant Resolver (`middleware/tenant.rs`)

Resolves the current tenant from the incoming request.

- Extracts tenant identity from either an **API key** (header-based) or a **JWT claim**.
- Sets `req.tenantId` for downstream use by all route handlers and services.
- Falls back to the default tenant (`stem_default`) when no tenant is specified.

#### Entitlements (`middleware/entitlements.rs`)

Feature-gating middleware that checks whether the current tenant's subscription plan includes the requested feature.

- Queries plan entitlements with a **120-second cache** to reduce database load.
- Returns `403 Forbidden` when the feature is not available on the current plan.

#### Monitoring (`routes/health.rs`)

Tracks request metrics and WebSocket connection statistics.

- Exposes `/health` for liveness checks and `/metrics` for observability.
- Records request counts, latencies, and error rates.

#### Error Handler (`error.rs`)

Custom `AppError` type that implements Axum's `IntoResponse` trait, formatting all errors into a consistent JSON response shape.

#### Localization (`middleware/localization.rs`)

Detects the client's preferred language from the `Accept-Language` header and sets `req.locale` for downstream use.

### Services

#### Stripe Service (`services/stripe.rs`)

Manages all interactions with the Stripe API:

- **Customer management** - Creates and retrieves Stripe customers linked to organisations.
- **Subscription lifecycle** - Creates subscriptions, handles upgrades/downgrades.
- **Checkout sessions** - Generates Stripe Checkout URLs for new subscriptions.
- **Billing portal** - Creates portal sessions for self-service subscription management.

#### Subscription Sync (`services/subscription_sync.rs`)

Processes Stripe webhook events and synchronises subscription state into the database.

```
Stripe Webhook Event
       |
       v
  Verify signature
       |
       v
  Parse event type (invoice.paid, subscription.updated, etc.)
       |
       v
  Update `subscriptions` table
       |
       v
  Provision / revoke `entitlements`
```

#### Leaderboard Service (`services/leaderboard.rs`)

High-performance leaderboard engine built on **sharded Redis sorted sets**.

```
Leaderboard Sharding (8 shards):

  Player Score Update
       |
       v
  Hash(playerId) % 8 → Shard N
       |
       v
  ZADD leaderboard:gameId:shardN score playerId

  Top-K Query:
       |
       v
  ZREVRANGE on all 8 shards → merge → sort → top K
       |
       v
  Cache result (30s TTL)

  Approx Rank Query:
       |
       v
  ZREVRANK on player's shard → estimate global rank
```

- **updateScore** - Inserts or updates a player's score in the appropriate shard.
- **getTopK** - Queries all shards, merges results, and returns the top K players.
- **getApproxRank** - Returns an estimated rank using the player's shard position.

#### Cache Service (`cache.rs`)

Thin abstraction over Redis providing key-value and sorted set operations. Used by the leaderboard service and entitlement middleware.

---

## Database Schema

The schema is managed through sequential migrations. Each migration builds on the previous, adding domain-specific tables.

### Entity Relationship Overview

```
tenants
  |
  +-- players (tenant_id, id) [composite PK]
  |     |
  |     +-- game_progress
  |     +-- score_history (partitioned by month)
  |     +-- player_achievements
  |     +-- player_settings
  |     +-- multiplayer_match_players
  |
  +-- organisations
  |     |
  |     +-- organisation_members
  |     +-- subscriptions
  |     +-- entitlements
  |     +-- storage_usage
  |     +-- usage_meters
  |
  +-- achievements
  |
  +-- plan_definitions
  |
  +-- game_categories
  |     |
  |     +-- game_category_assignments
  |
  +-- custom_games
  |
  +-- comments / reviews / reports
  |
  +-- multiplayer_matches
```

### Migration 001 - Core Tables

| Table                 | Purpose                                              |
|-----------------------|------------------------------------------------------|
| `tenants`             | Multi-tenant configuration (name, settings, API key) |
| `players`             | Player profiles. Composite PK: `(id, tenant_id)`. Indexed for leaderboard queries. |
| `game_progress`       | Per-game scores, star counts, play counts            |
| `score_history`       | Append-only score log. **Partitioned by month** (2026-01 through 2026-12) for query performance. |
| `player_achievements` | Earned achievements per player                       |
| `player_settings`     | Per-player preferences                               |
| `achievements`        | Achievement definitions                              |

**Score history partitioning** ensures that queries scoped to a time range only scan the relevant partition, keeping read latency predictable as the table grows.

### Migration 002 - Billing

| Table                    | Purpose                                           |
|--------------------------|---------------------------------------------------|
| `organisations`          | Team/school workspaces with Stripe customer ID    |
| `organisation_members`   | Membership with roles: `owner`, `admin`, `member` |
| `subscriptions`          | Stripe subscription mirror                        |
| `entitlements`           | Feature flags with limits and current usage        |
| `plan_definitions`       | Plan catalog                                      |
| `storage_usage`          | Per-org storage tracking                          |
| `usage_meters`           | Metered feature usage counters                    |

**Plan tiers:**

| Plan       | Price/month | Target Audience              |
|------------|-------------|------------------------------|
| Free       | $0.00       | Individual students          |
| Starter    | $19.99      | Small classrooms             |
| Pro        | $49.99      | Schools                      |
| Enterprise | $149.99     | Districts / large orgs       |

### Migration 003 - Social

Adds community features: comments, reviews, reports, and a moderation queue.

### Migration 004 - Multiplayer

| Table                        | Purpose                                    |
|------------------------------|--------------------------------------------|
| `multiplayer_matches`        | Match metadata (game, mode, status, result)|
| `multiplayer_match_players`  | Per-player match participation             |

Also adds columns to `players`: `mp_wins`, `mp_losses`, `mp_draws` for lifetime stats.

### Migration 005 - Custom Games

Stores custom game definitions including the Phaser Scene source code, which is evaluated client-side via `new Function()`.

### Migration 007 - Categories

| Table                        | Purpose                                    |
|------------------------------|--------------------------------------------|
| `game_categories`            | Category definitions (name, description)   |
| `game_category_assignments`  | Many-to-many: games to categories          |

---

## Multi-Tenant Architecture

The platform isolates data by tenant, allowing multiple schools or organisations to share the same deployment.

```
Tenant Resolution Flow:

  Request arrives
       |
       +-- Has API key header?
       |     |
       |     Yes → Parse key: tenant_{tenantId}_{secret}
       |     |      Validate → set req.tenantId
       |     |
       |     No  → Has JWT?
       |            |
       |            Yes → Extract tenantId claim → set req.tenantId
       |            |
       |            No  → Use default: "stem_default"
       |
       v
  All subsequent queries include WHERE tenant_id = ?
```

**Isolation guarantees:**

- Every data table includes a `tenant_id` column.
- Composite primary keys (e.g., `players(id, tenant_id)`) prevent cross-tenant ID collisions.
- API key format: `tenant_{tenantId}_{secret}` embeds the tenant ID directly for efficient resolution.
- The default tenant `stem_default` serves unauthenticated or single-tenant deployments.
- Entitlement middleware gates features per tenant based on their subscription plan.

---

## Multiplayer System

### WebSocket Server

The WebSocket server handles real-time multiplayer communication.

```
Connection Flow:

  Client                          Server
    |                               |
    |-- WSS connect + JWT token --->|
    |                               |-- Verify JWT
    |                               |-- Associate connection with player
    |<--- connection_ack -----------|
    |                               |
    |-- join_room {roomId} -------->|
    |                               |-- Validate room
    |<--- room_state ---------------|
    |                               |
    |-- game_input {seq, data} ---->|
    |                               |-- Validate input
    |                               |-- Update authoritative state
    |<--- state_update {seq, ...} --|
    |                               |
```

- Authentication via **JWT token in the query string** on connection.
- All messages use a **JSON protocol** with type-discriminated payloads.
- Room lifecycle: `waiting` -> `playing` -> `finished`.
- Limits: **8 players per room**, **1-hour TTL** per room (auto-cleanup).

### Authoritative Server Model

The server maintains the authoritative game state. Clients predict locally but defer to server corrections.

```
Tick Rates by Game Type:

  Turn-based games:  20 Hz  (50ms per tick)
  Casual games:      30 Hz  (33ms per tick)
  Action games:      60 Hz  (16ms per tick)

Server Tick Loop:
  [Collect Inputs] → [Validate] → [Simulate] → [Broadcast State]
       |                  |             |               |
       |            Reject invalid   Physics /     Send delta to
       |            inputs           game logic    all clients
       |
  Buffer up to
  1 tick of inputs
```

- **Server-owned state**: The server is the single source of truth for all game state.
- **Client-side prediction**: Clients apply inputs locally immediately, then reconcile against server state.
- **State history**: The server retains **60 frames of history** to support client reconciliation and replay.

### Matchmaking

Skill-based matchmaking inspired by the **Glicko-2** rating system.

```
Matchmaking Flow:

  Player joins queue
       |
       v
  Initial skill range: +/- 100
       |
       v
  Search for opponents in range
       |
       +-- Found? → Create room, start match
       |
       +-- Not found? → Wait 5 seconds
                |
                v
          Expand range by +50
                |
                v
          Repeat (max range: +/- 500)
```

- **Region-aware**: Matchmaking pools are segmented by region (`us-east`, `eu-west`, `asia-east`, `oceania`).
- **Skill range expansion**: Starts at +/-100, expands by 50 every 5 seconds, caps at +/-500.
- **Placement matches**: Players complete **10 placement matches** before their rating stabilises.

### Anti-Cheat System

Multiple detection layers run server-side to identify cheating.

| Check                  | Threshold              | Action                    |
|------------------------|------------------------|---------------------------|
| Input rate             | 30 actions/second max  | Excess inputs dropped     |
| Movement speed         | 15 distance/tick max   | Position corrected        |
| Score anomaly          | 1000 points/action max | Score rejected            |
| Win rate analysis      | 85%+ with 20+ matches  | Flagged for review        |
| Critical flag auto-ban | 3 flags in 24 hours    | Automatic account ban     |

---

## Authentication Flow

```
Guest Flow:
  Client                              Server
    |-- POST /auth/guest ------------>|
    |                                 |-- Create player (guest)
    |                                 |-- Generate JWT
    |<-- { accessToken, refresh } ----|
    |                                 |

Registration Flow:
  Client                              Server
    |-- POST /auth/register --------->|
    |   { username, password }        |-- Validate input
    |                                 |-- bcrypt(password, rounds=12)
    |                                 |-- Insert player
    |                                 |-- Generate JWT
    |<-- { accessToken, refresh } ----|
    |                                 |

Login Flow:
  Client                              Server
    |-- POST /auth/login ------------>|
    |   { username, password }        |-- Fetch player
    |                                 |-- bcrypt.compare()
    |                                 |-- Generate JWT
    |<-- { accessToken, refresh } ----|
    |                                 |

Token Refresh:
  Client                              Server
    |-- POST /auth/refresh ---------->|
    |   { refreshToken }              |-- Verify refresh token
    |                                 |-- Generate new access token
    |<-- { accessToken } -------------|
```

**Token configuration:**

| Token Type    | Lifetime |
|---------------|----------|
| Access token  | 1 hour   |
| Refresh token | 30 days  |

The client automatically attempts a token refresh when it receives a `401 Unauthorized` response.

---

## Billing Flow

```
Organisation Setup:
  Admin creates org
       |
       v
  Stripe Customer created (linked to org)
       |
       v
  Admin selects plan → Stripe Checkout session
       |
       v
  Stripe processes payment
       |
       v
  Webhook: invoice.paid
       |
       v
  subscriptionSync: Update DB → Provision entitlements
       |
       v
  Entitlement middleware now gates features by plan

Plan Change:
  Admin upgrades/downgrades via Stripe portal
       |
       v
  Webhook: customer.subscription.updated
       |
       v
  subscriptionSync: Update subscription record
       |
       v
  Recalculate entitlements (provision new / revoke old)

Trial:
  - Default trial period: 14 days
  - Trial includes Starter-tier features
  - On expiry: downgrades to Free if no payment method
```

---

## Data Flow: Score Submission

The complete lifecycle of a score from the game scene to the leaderboard.

```
[Game Scene]
     | Player completes level / round
     v
[Launcher.saveGameScore(gameId, score)]
     | Calculates stars from per-game thresholds
     v
[SaveManager]
     | Writes to localStorage (stem_adventures_progress)
     | Enqueues to sync queue (stem_adventures_sync_queue)
     v
[CloudSyncAPI] (30-second interval)
     | Dequeues batch (max 20 items)
     | POST /api/v1/scores/:gameId
     v
[Score Route Handler]
     | Validates score, checks rate limit (30/min)
     v
[Database Transaction]
     | 1. UPSERT game_progress (update best score, stars, play count)
     | 2. INSERT score_history (append-only, partitioned by month)
     | 3. UPDATE players (total_score, total_stars)
     v
[Leaderboard Service]
     | Hash(playerId) % 8 → shard
     | ZADD leaderboard:{gameId}:{shard} score playerId
     v
[Redis Cache Updated]
     | Cached top-K results invalidated (30s TTL handles this)
     v
[Done - score visible on leaderboards within 30 seconds]
```

**Failure handling:**

- If the network request fails, the score remains in the `sync_queue` in localStorage.
- CloudSyncAPI retries with exponential backoff on subsequent intervals.
- Scores are never lost as long as localStorage is intact.

---

## Caching Strategy

Redis serves as the caching layer for hot paths. The strategy balances freshness with throughput.

```
Cache Topology:

  +----------------------------------+
  |            Redis                  |
  |                                   |
  |  Sorted Sets (Leaderboards)       |
  |  +----------------------------+   |
  |  | leaderboard:{game}:{shard} |   |
  |  | TTL: 2 hours               |   |
  |  | Shards: 8 per game         |   |
  |  +----------------------------+   |
  |                                   |
  |  Key-Value (Entitlements)         |
  |  +----------------------------+   |
  |  | entitlement:{tenantId}     |   |
  |  | TTL: 120 seconds           |   |
  |  +----------------------------+   |
  |                                   |
  |  Key-Value (Leaderboard Results)  |
  |  +----------------------------+   |
  |  | lb_result:{game}:{params}  |   |
  |  | TTL: 30 seconds            |   |
  |  +----------------------------+   |
  |                                   |
  +----------------------------------+
```

| Cache Target          | Storage Type      | TTL        | Purpose                              |
|-----------------------|-------------------|------------|--------------------------------------|
| Leaderboard scores    | Redis sorted sets | 2 hours    | Fast rank queries without DB         |
| Leaderboard results   | Redis key-value   | 30 seconds | Avoid repeated merge-sort across shards |
| Entitlements          | Redis key-value   | 120 seconds| Reduce DB queries on every request   |

---

## Deployment

### Architecture

```
+---------------------+       +---------------------------+
|      Vercel          |       |       Shuttle.dev         |
|                      |       |                           |
|  +----------------+  |       |  +---------------------+  |
|  | React Build    |  |       |  | Rust/Axum Server    |  |
|  | (static SPA)   |  |       |  | (persistent process)|  |
|  +----------------+  |       |  | REST API + WebSocket |  |
|                      |       |  +---------------------+  |
|  +----------------+  |       |           |               |
|  | WASM bundle    |  |       +---------------------------+
|  | (Bevy engine)  |  |                   |
|  +----------------+  |                   |
|         |            |                   |
+---------+------------+                   |
          |                                |
     Proxies /api/*                        |
     to Shuttle                            |
          |                                |
          v                                v
  +---------------+                 +---------------+
  |  PostgreSQL   |                 |     Redis     |
  +---------------+                 +---------------+
```

### Deployment Considerations

- **Vercel** hosts the static React frontend and the WASM game engine bundle. API requests are proxied to the Shuttle backend.

- **Shuttle.dev** hosts the Rust/Axum backend as a **persistent process** (not serverless). This means WebSocket connections, in-memory game rooms, and connection pools work natively without cold-start concerns.

- **Connection pooling**: Database connections are pooled via SQLx with configurable bounds (**5 minimum, 50 maximum**) to balance resource usage with concurrent request handling.

- **WASM build**: The Bevy game engine is compiled to `wasm32-unknown-unknown` and bound with `wasm-bindgen`. The output is placed in `client/public/wasm/` before the Vercel build.

---

## Scalability

The platform is designed to scale across several dimensions.

### Data Layer Scaling

| Mechanism                  | Detail                                                    |
|----------------------------|-----------------------------------------------------------|
| Partitioned score_history  | Monthly partitions (2026-01 through 2026-12). Queries scoped to a date range only scan relevant partitions. |
| Sharded leaderboards       | Configurable shard count (default 8). Distributes write load and limits sorted set size per shard. |
| Connection pooling         | Configurable min/max (default 5-50). Prevents connection exhaustion under load. |

### Compute Layer Scaling

| Mechanism                  | Detail                                                    |
|----------------------------|-----------------------------------------------------------|
| Persistent Rust API (Shuttle) | Always-on process with native WebSocket support. No cold starts. Horizontal scaling via Shuttle Pro. |
| Stateless JWT auth         | No server-side session storage. Any instance can validate any token. Enables horizontal scaling without session affinity. |
| Redis cache layer          | Absorbs read load for leaderboards and entitlements, protecting PostgreSQL from hot-path queries. |

### Scaling Limits and Bottlenecks

| Component                  | Scaling Limit                                             |
|----------------------------|-----------------------------------------------------------|
| WebSocket server           | Single process; horizontal scaling requires sticky sessions or a pub/sub relay (Redis Pub/Sub). |
| Leaderboard merge-sort     | Top-K queries touch all 8 shards; cost grows linearly with shard count. Mitigated by 30-second result caching. |
| Custom game evaluation     | `new Function()` execution is CPU-bound on the client. No server-side sandboxing. |
