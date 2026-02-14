# Minigames Platform API Reference

Complete API documentation for the Minigames platform. The backend is built with Rust (Axum 0.7) and deployed as a serverless function on Vercel via the `vercel-rust` builder. This document covers all REST endpoints, WebSocket protocol, authentication, error handling, and subscription plans.

---

## Table of Contents

- [Base URL](#base-url)
- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Error Responses](#error-responses)
- [Endpoints](#endpoints)
  - [Authentication](#authentication-auth)
  - [Player Profile](#player-profile-player)
  - [Scores](#scores-scores)
  - [Leaderboards](#leaderboards-leaderboards)
  - [Games & Categories](#games--categories-games)
  - [Multiplayer](#multiplayer-multiplayer)
  - [Friends](#friends-friends)
  - [Presence](#presence-presence)
  - [Billing](#billing-billing)
  - [Organisations](#organisations-organisations)
  - [Economy](#economy-economy)
  - [Comments & Reviews](#comments--reviews-comments)
  - [Compliance (GDPR/CCPA)](#compliance-gdprccpa-compliance)
  - [Batch Sync](#batch-sync-sync)
  - [Webhooks](#webhooks-webhooks)
  - [Admin](#admin-admin)
  - [Admin Games](#admin-games-admingames)
- [WebSocket Protocol](#websocket-protocol)
- [Subscription Plans](#subscription-plans)

---

## Base URL

| Environment | URL |
|---|---|
| Local | `http://localhost:3000/api/v1` |
| Production | `https://minigames.cool/api/v1` |
| WebSocket (Local) | `ws://localhost:3000/ws` |
| WebSocket (Production) | `wss://minigames.cool/ws` |

All REST endpoint paths in this document are relative to the base URL. For example, `POST /auth/login` refers to `http://localhost:3000/api/v1/auth/login` in development.

---

## Authentication

The platform uses JSON Web Tokens (JWT) for authentication. Tokens are passed in the `Authorization` header using the Bearer scheme.

```
Authorization: Bearer <access_token>
```

| Token Type | Expiry | Usage |
|---|---|---|
| Access Token | 1 hour | Passed in `Authorization` header for all authenticated requests |
| Refresh Token | 30 days | Sent to `POST /auth/refresh` to obtain a new access token |

### Obtaining Tokens

Tokens are returned from `POST /auth/guest`, `POST /auth/register`, and `POST /auth/login`. When the access token expires, use the refresh token to get a new pair without requiring the user to log in again.

### Auth Requirement Legend

Throughout this document, the **Auth** column in endpoint tables uses:

| Value | Meaning |
|---|---|
| **None** | No authentication required |
| **JWT** | Valid access token required in `Authorization: Bearer` header |
| **Optional** | Token accepted but not required; unauthenticated users receive public data |

---

## Rate Limiting

All endpoints are subject to rate limiting. Limits are applied per IP address unless otherwise noted.

| Scope | Limit |
|---|---|
| General (all endpoints) | 100 requests/minute per IP |
| Score submission (`POST /scores/:gameId`) | 30 requests/minute per player |

### Rate Limit Headers

Every response includes rate limit information:

| Header | Description |
|---|---|
| `X-RateLimit-Remaining` | Number of requests remaining in the current window |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when the rate limit window resets |

When the limit is exceeded, the server responds with HTTP `429 Too Many Requests`.

---

## Error Responses

All errors follow a consistent JSON format:

```json
{
  "error": "Human-readable error description",
  "code": "MACHINE_READABLE_CODE"
}
```

### Common HTTP Status Codes

| Status | Meaning |
|---|---|
| `400` | Bad Request -- invalid or missing parameters |
| `401` | Unauthorized -- missing or invalid authentication token |
| `403` | Forbidden -- authenticated but insufficient permissions |
| `404` | Not Found -- resource does not exist |
| `409` | Conflict -- duplicate resource or state conflict |
| `429` | Too Many Requests -- rate limit exceeded |
| `500` | Internal Server Error |

### Common Error Codes

| Code | Description |
|---|---|
| `TRIAL_ALREADY_USED` | Player has already used their free trial |

---

## Endpoints

### Authentication (`/auth`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/guest` | None | Register or resume a guest session |
| `POST` | `/auth/register` | None | Create a full account with email and password |
| `POST` | `/auth/login` | None | Log in with email and password |
| `POST` | `/auth/refresh` | None | Exchange a refresh token for a new token pair |

#### `POST /auth/guest`

Register a new guest player or resume an existing guest session. No email or password required.

**Request Body:**

```json
{
  "playerId": "optional-existing-uuid",
  "displayName": "Explorer",
  "avatarCharacter": "guha"
}
```

All fields are optional. If `playerId` is omitted, a new UUID is generated. Default `displayName` is `"Explorer"` and default `avatarCharacter` is `"guha"`.

**Response `200 OK`:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "player": {
    "playerId": "550e8400-e29b-41d4-a716-446655440000",
    "displayName": "Explorer",
    "avatarCharacter": "guha",
    "isGuest": true,
    "totalScore": 0,
    "gamesPlayed": 0,
    "createdAt": "2025-01-15T12:00:00.000Z"
  }
}
```

---

#### `POST /auth/register`

Create a full account. Can also upgrade an existing guest account by providing the guest's `playerId`.

**Request Body:**

```json
{
  "email": "player@example.com",
  "password": "securepassword123",
  "displayName": "SpaceCadet",
  "playerId": "optional-existing-guest-uuid",
  "avatarCharacter": "guha"
}
```

| Field | Required | Validation |
|---|---|---|
| `email` | Yes | Valid email, unique per tenant |
| `password` | Yes | Minimum 8 characters |
| `displayName` | No | Defaults to `"Explorer"` |
| `playerId` | No | Pass existing guest UUID to upgrade account |
| `avatarCharacter` | No | Defaults to `"guha"` |

**Response `201 Created`:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "player": {
    "playerId": "550e8400-e29b-41d4-a716-446655440000",
    "displayName": "SpaceCadet",
    "avatarCharacter": "guha",
    "isGuest": false,
    "totalScore": 0,
    "gamesPlayed": 0,
    "createdAt": "2025-01-15T12:00:00.000Z"
  }
}
```

**Error Responses:**

| Status | Error | When |
|---|---|---|
| `400` | `"Email and password required"` | Missing email or password |
| `400` | `"Password must be at least 8 characters"` | Password too short |
| `409` | `"Email already registered"` | Email already in use |

---

#### `POST /auth/login`

Authenticate with email and password. Returns tokens, player profile, and all game progress for client-side data merge.

**Request Body:**

```json
{
  "email": "player@example.com",
  "password": "securepassword123"
}
```

**Response `200 OK`:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "player": {
    "playerId": "550e8400-e29b-41d4-a716-446655440000",
    "displayName": "SpaceCadet",
    "avatarCharacter": "guha",
    "isGuest": false,
    "totalScore": 15000,
    "gamesPlayed": 42,
    "createdAt": "2025-01-15T12:00:00.000Z"
  },
  "playerData": {
    "player": { "...same as above..." },
    "progress": {
      "PhysicsMasterBilliards": {
        "highScore": 1200,
        "bestTime": 45000,
        "level": 3,
        "stars": 2,
        "playCount": 10,
        "totalScore": 8500,
        "lastPlayed": "2025-03-20T14:30:00.000Z"
      }
    }
  }
}
```

**Error Responses:**

| Status | Error | When |
|---|---|---|
| `400` | `"Email and password required"` | Missing credentials |
| `401` | `"Invalid credentials"` | Wrong email or password |

---

#### `POST /auth/refresh`

Exchange a valid refresh token for a new access/refresh token pair. Use this before the access token expires.

**Request Body:**

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Response `200 OK`:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Error Responses:**

| Status | Error | When |
|---|---|---|
| `400` | `"Refresh token required"` | Missing token in body |
| `401` | `"Invalid refresh token"` | Token is expired, malformed, or not a refresh token |

---

### Player Profile (`/player`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/player/profile` | JWT | Get player profile with aggregate stats |
| `PUT` | `/player/profile` | JWT | Update display name or avatar |
| `GET` | `/player/progress` | JWT | Get progress across all games |
| `GET` | `/player/achievements` | JWT | Get player's achievement list |

#### `GET /player/profile`

**Response `200 OK`:**

```json
{
  "playerId": "550e8400-e29b-41d4-a716-446655440000",
  "displayName": "SpaceCadet",
  "avatarCharacter": "guha",
  "isGuest": false,
  "totalScore": 15000,
  "gamesPlayed": 42,
  "createdAt": "2025-01-15T12:00:00.000Z"
}
```

---

#### `PUT /player/profile`

**Request Body:**

```json
{
  "displayName": "NewName",
  "avatarCharacter": "nova"
}
```

Both fields are optional. Only provided fields are updated.

---

#### `GET /player/progress`

Returns a map of `gameId` to progress data for every game the player has played.

**Response `200 OK`:**

```json
{
  "progress": {
    "PhysicsMasterBilliards": {
      "highScore": 1200,
      "bestTime": 45000,
      "level": 3,
      "stars": 2,
      "playCount": 10,
      "totalScore": 8500,
      "lastPlayed": "2025-03-20T14:30:00.000Z"
    },
    "CampusDash": {
      "highScore": 5200,
      "bestTime": null,
      "level": 5,
      "stars": 3,
      "playCount": 25,
      "totalScore": 42000,
      "lastPlayed": "2025-03-21T09:15:00.000Z"
    }
  }
}
```

---

#### `GET /player/achievements`

**Response `200 OK`:**

```json
{
  "achievements": [
    {
      "id": "first_win",
      "name": "First Victory",
      "description": "Win your first game",
      "unlockedAt": "2025-01-16T08:00:00.000Z"
    }
  ]
}
```

---

### Scores (`/scores`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/scores/:gameId` | JWT | Submit a score for a game |
| `GET` | `/scores/:gameId` | JWT | Get player's progress for a specific game |

#### `POST /scores/:gameId`

Submit a score after completing a game. The server automatically updates high scores, star ratings, play counts, player totals, and leaderboard caches.

Rate limited to **30 requests/minute** per player.

**Path Parameters:**

| Parameter | Description |
|---|---|
| `gameId` | The game identifier (e.g., `"PhysicsMasterBilliards"`, `"CampusDash"`) |

**Request Body:**

```json
{
  "score": 1500,
  "time": 45000,
  "level": 3,
  "customData": {},
  "timestamp": 1711000000000
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `score` | number | Yes | Must be `0`-`999999` |
| `time` | number | No | Time in milliseconds |
| `level` | number | No | Defaults to `1` |
| `customData` | object | No | Arbitrary game-specific data |
| `timestamp` | number | No | Client-side timestamp |

**Response `200 OK`:**

```json
{
  "gameId": "PhysicsMasterBilliards",
  "score": 1500,
  "highScore": 1500,
  "stars": 3,
  "level": 3,
  "playCount": 11,
  "isNewHigh": true
}
```

The `stars` field is calculated from game-specific score thresholds (0-3 stars). `isNewHigh` is `true` when the submitted score equals the current `highScore` (i.e., a new personal best was set).

**Error Responses:**

| Status | Error | When |
|---|---|---|
| `400` | `"Invalid score"` | Score is not a number or is negative |
| `400` | `"Score exceeds maximum"` | Score is greater than 999999 |
| `429` | Rate limited | More than 30 submissions/minute |

---

#### `GET /scores/:gameId`

Get the authenticated player's progress for a specific game.

**Response `200 OK`:**

```json
{
  "gameId": "PhysicsMasterBilliards",
  "highScore": 1500,
  "bestTime": 45000,
  "stars": 3,
  "level": 3,
  "playCount": 11,
  "totalScore": 10000,
  "lastPlayed": "2025-03-21T14:30:00.000Z"
}
```

If the player has never played the game:

```json
{
  "gameId": "PhysicsMasterBilliards",
  "highScore": 0,
  "stars": 0,
  "level": 1,
  "playCount": 0
}
```

---

### Leaderboards (`/leaderboards`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/leaderboards/:gameId` | Optional | Get a game's leaderboard |
| `GET` | `/leaderboards/:gameId/me` | JWT | Get the player's rank on a game leaderboard |
| `GET` | `/leaderboards/:gameId/around` | JWT | Get ranks surrounding the player |
| `GET` | `/leaderboards/:gameId/friends` | JWT | Leaderboard filtered to the player's friends |
| `GET` | `/leaderboards/:gameId/ranked` | Optional | Ranked/seasonal leaderboard |
| `GET` | `/leaderboards/global` | Optional | Aggregate leaderboard across all games |
| `GET` | `/leaderboards/seasons` | None | List all seasons |
| `GET` | `/leaderboards/seasons/current` | None | Get the current active season |
| `POST` | `/leaderboards/submit-match` | JWT | Submit a multiplayer match result |

#### `GET /leaderboards/:gameId`

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | 50 | Number of entries (max 100) |
| `offset` | number | 0 | Pagination offset |
| `period` | string | `"all"` | Time period: `"all"`, `"daily"`, `"weekly"`, `"monthly"` |

**Response `200 OK`:**

```json
{
  "leaderboard": [
    {
      "rank": 1,
      "playerId": "abc-123",
      "displayName": "TopPlayer",
      "score": 9500,
      "stars": 3
    },
    {
      "rank": 2,
      "playerId": "def-456",
      "displayName": "RunnerUp",
      "score": 8200,
      "stars": 3
    }
  ],
  "total": 1250,
  "limit": 50,
  "offset": 0
}
```

---

#### `GET /leaderboards/:gameId/me`

**Response `200 OK`:**

```json
{
  "rank": 42,
  "playerId": "550e8400-e29b-41d4-a716-446655440000",
  "displayName": "SpaceCadet",
  "score": 1500,
  "stars": 3,
  "total": 1250
}
```

---

#### `GET /leaderboards/:gameId/around`

Returns the player's rank along with a window of nearby entries (typically 5 above and 5 below).

---

#### `GET /leaderboards/:gameId/friends`

Returns a leaderboard filtered to the authenticated player's friend list.

---

#### `GET /leaderboards/global`

Aggregate leaderboard across all games, ranked by total score.

---

#### `GET /leaderboards/seasons`

**Response `200 OK`:**

```json
{
  "seasons": [
    {
      "id": "season-2025-spring",
      "name": "Spring 2025",
      "startsAt": "2025-03-01T00:00:00.000Z",
      "endsAt": "2025-05-31T23:59:59.000Z",
      "isActive": true
    }
  ]
}
```

---

#### `POST /leaderboards/submit-match`

Submit the result of a multiplayer match for ranked leaderboard processing.

**Request Body:**

```json
{
  "gameId": "PhysicsMasterBilliards",
  "roomId": "room-abc-123",
  "players": [
    { "playerId": "abc-123", "score": 1500, "placement": 1 },
    { "playerId": "def-456", "score": 1200, "placement": 2 }
  ]
}
```

---

### Games & Categories (`/games`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/games/custom` | None | List all active custom games |
| `GET` | `/games/categories` | None | List active categories with game assignments |

#### `GET /games/custom`

Returns all active custom games for the current tenant.

**Response `200 OK`:**

```json
{
  "games": [
    {
      "id": "PhysicsMasterBilliards",
      "title": "Physics Master Billiards",
      "classic": "billiards",
      "character_id": "newton",
      "mechanic": "physics",
      "icon_color": "#4A90D9",
      "icon_emoji": "🎱",
      "scene_code": "...",
      "sort_order": 10,
      "category_id": "physics",
      "categories": ["physics", "strategy"]
    }
  ]
}
```

---

#### `GET /games/categories`

Returns active categories with their assigned game IDs.

**Response `200 OK`:**

```json
{
  "categories": [
    {
      "id": "physics",
      "name": "Physics",
      "slug": "physics",
      "description": "Games involving physical simulations",
      "icon_emoji": "⚛️",
      "icon_color": "#4A90D9",
      "sort_order": 10,
      "gameIds": ["PhysicsMasterBilliards", "GravityShiftRun"]
    }
  ]
}
```

---

### Multiplayer (`/multiplayer`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/multiplayer/rooms` | JWT | List public rooms |
| `POST` | `/multiplayer/rooms` | JWT | Create a new game room |
| `GET` | `/multiplayer/rooms/:id` | JWT | Get room details |
| `POST` | `/multiplayer/rooms/:id/join` | JWT | Join an existing room |
| `POST` | `/multiplayer/matchmake` | JWT | Quick matchmaking |
| `GET` | `/multiplayer/me` | JWT | Get player's active room |

#### `GET /multiplayer/rooms`

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `gameId` | string | - | Filter by game |
| `state` | string | `"waiting"` | Room state filter |

**Response `200 OK`:**

```json
{
  "rooms": [
    {
      "id": "room-abc-123",
      "gameId": "PhysicsMasterBilliards",
      "name": "Casual Match",
      "state": "waiting",
      "maxPlayers": 4,
      "playerCount": 2,
      "isPrivate": false,
      "host": {
        "id": "abc-123",
        "displayName": "HostPlayer"
      }
    }
  ]
}
```

---

#### `POST /multiplayer/rooms`

**Request Body:**

```json
{
  "gameId": "PhysicsMasterBilliards",
  "name": "My Room",
  "maxPlayers": 4,
  "isPrivate": false
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `gameId` | string | Yes | Game to play |
| `name` | string | No | Room display name |
| `maxPlayers` | number | No | Maximum players allowed |
| `isPrivate` | boolean | No | If true, room is not listed publicly |

**Response `201 Created`:**

```json
{
  "room": {
    "id": "room-abc-123",
    "gameId": "PhysicsMasterBilliards",
    "name": "My Room",
    "state": "waiting",
    "maxPlayers": 4,
    "players": [
      { "id": "abc-123", "displayName": "HostPlayer", "avatar": "guha", "ready": false }
    ],
    "host": "abc-123",
    "isPrivate": false
  }
}
```

---

#### `POST /multiplayer/rooms/:id/join`

**Response `200 OK`:**

```json
{
  "room": {
    "id": "room-abc-123",
    "gameId": "PhysicsMasterBilliards",
    "state": "waiting",
    "players": [
      { "id": "abc-123", "displayName": "HostPlayer", "avatar": "guha", "ready": false },
      { "id": "def-456", "displayName": "JoinedPlayer", "avatar": "guha", "ready": false }
    ]
  }
}
```

---

#### `POST /multiplayer/matchmake`

Find an available room or create a new one automatically.

**Request Body:**

```json
{
  "gameId": "PhysicsMasterBilliards"
}
```

---

#### `GET /multiplayer/me`

Returns the player's currently active room, or `null` if not in a room.

**Response `200 OK`:**

```json
{
  "room": null
}
```

---

### Friends (`/friends`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/friends` | JWT | List all friends |
| `GET` | `/friends/requests` | JWT | List pending friend requests |
| `GET` | `/friends/online` | JWT | List online friends |
| `POST` | `/friends/request` | JWT | Send a friend request |
| `POST` | `/friends/:id/accept` | JWT | Accept a friend request |
| `POST` | `/friends/:id/decline` | JWT | Decline a friend request |
| `POST` | `/friends/:id/remove` | JWT | Remove a friend |
| `POST` | `/friends/:id/block` | JWT | Block a player |
| `POST` | `/friends/:id/unblock` | JWT | Unblock a player |
| `GET` | `/friends/blocked` | JWT | List blocked players |
| `POST` | `/friends/:id/invite` | JWT | Invite a friend to a game |
| `GET` | `/friends/search` | JWT | Search for players |

#### `POST /friends/request`

**Request Body:**

```json
{
  "targetPlayerId": "def-456"
}
```

---

#### `GET /friends/search`

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `q` | string | Search query (matches display name) |
| `limit` | number | Max results (default 20) |

**Response `200 OK`:**

```json
{
  "players": [
    {
      "playerId": "def-456",
      "displayName": "FoundPlayer",
      "avatarCharacter": "nova",
      "isFriend": false,
      "isPending": false
    }
  ]
}
```

---

### Presence (`/presence`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/presence/me` | JWT | Get own presence status |
| `POST` | `/presence/update` | JWT | Update current status |
| `POST` | `/presence/heartbeat` | JWT | Send keep-alive heartbeat |
| `GET` | `/presence/:id` | JWT | Get another player's presence |

#### `POST /presence/update`

**Request Body:**

```json
{
  "status": "online",
  "activity": "playing",
  "gameId": "PhysicsMasterBilliards"
}
```

| Field | Type | Description |
|---|---|---|
| `status` | string | `"online"`, `"away"`, `"busy"`, `"offline"` |
| `activity` | string | `"idle"`, `"browsing"`, `"playing"`, `"in_lobby"` |
| `gameId` | string | Current game (if playing) |

---

#### `POST /presence/heartbeat`

Clients should send heartbeats at regular intervals to maintain `"online"` presence. Players without a heartbeat are automatically marked offline.

**Response `200 OK`:**

```json
{
  "status": "online",
  "serverTime": 1711000000000
}
```

---

### Billing (`/billing`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/billing/plans` | Optional | List available subscription plans |
| `GET` | `/billing/status` | JWT | Get current subscription status |
| `POST` | `/billing/subscribe` | JWT | Create a new subscription or start a trial |
| `POST` | `/billing/portal` | JWT | Get a Stripe billing portal URL |
| `POST` | `/billing/cancel` | JWT | Cancel a subscription |
| `POST` | `/billing/resume` | JWT | Resume a canceled subscription |
| `GET` | `/billing/usage` | JWT | Get usage meters and storage |
| `GET` | `/billing/entitlements` | JWT | Get feature entitlements for the organisation |
| `GET` | `/billing/upgrade-badge` | JWT | Check whether an upgrade badge should be shown |

#### `GET /billing/plans`

Returns available plans with Stripe integration details.

**Response `200 OK`:**

```json
{
  "plans": [
    {
      "id": "plan-free",
      "tier": "free",
      "name": "Free",
      "priceCents": 0,
      "billingPeriod": "month",
      "maxMembers": 1,
      "maxStorageMb": 50,
      "maxGames": 5,
      "features": { "multiplayer": false, "analytics": false },
      "stripePriceId": null
    },
    {
      "id": "plan-starter",
      "tier": "starter",
      "name": "Starter",
      "priceCents": 1999,
      "billingPeriod": "month",
      "maxMembers": 5,
      "maxStorageMb": 500,
      "maxGames": 25,
      "features": { "multiplayer": true, "analytics": true },
      "stripePriceId": "price_1..."
    }
  ],
  "stripePricingTableId": "prctbl_1...",
  "stripePublishableKey": "pk_live_..."
}
```

---

#### `GET /billing/status`

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `orgId` | string | Organisation ID (optional; uses first org if omitted) |

**Response `200 OK` (with subscription):**

```json
{
  "hasOrganisation": true,
  "organisationId": "org-abc-123",
  "organisationName": "My Team",
  "subscription": {
    "id": "sub-abc-123",
    "status": "active",
    "planTier": "pro",
    "trialEnd": null,
    "currentPeriodEnd": "2025-04-15T00:00:00.000Z",
    "cancelAt": null
  },
  "plan": "pro",
  "trialAvailable": false
}
```

**Response `200 OK` (free player, no organisation):**

```json
{
  "hasOrganisation": false,
  "subscription": null,
  "plan": "free",
  "trialAvailable": true
}
```

---

#### `POST /billing/subscribe`

Create a Stripe subscription or start a free trial.

**Request Body:**

```json
{
  "organisationId": "org-abc-123",
  "planTier": "starter",
  "trial": true
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `organisationId` | string | Yes | Organisation to subscribe |
| `planTier` | string | Yes | One of: `"starter"`, `"pro"`, `"enterprise"` |
| `trial` | boolean | No | Start a free trial (14 days, one per user) |

**Response `201 Created`:**

```json
{
  "subscription": {
    "id": "sub-abc-123",
    "status": "trialing",
    "planTier": "starter",
    "trialEnd": "2025-04-01T00:00:00.000Z",
    "currentPeriodEnd": "2025-04-15T00:00:00.000Z"
  },
  "clientSecret": "pi_abc_secret_xyz",
  "stripeSubscriptionId": "sub_stripe_abc123"
}
```

**Error Responses:**

| Status | Error | Code | When |
|---|---|---|---|
| `400` | `"organisationId and planTier required"` | - | Missing required fields |
| `403` | `"Not the organisation owner"` | - | Player does not own the org |
| `409` | `"Organisation already has an active subscription"` | - | Active sub already exists |
| `409` | `"You have already used your free trial"` | `TRIAL_ALREADY_USED` | Trial already consumed |

---

#### `POST /billing/portal`

Generate a Stripe Customer Portal URL for self-service billing management (update payment method, view invoices, etc.).

**Request Body:**

```json
{
  "organisationId": "org-abc-123",
  "returnUrl": "https://minigames.cool/settings/billing"
}
```

**Response `200 OK`:**

```json
{
  "url": "https://billing.stripe.com/session/..."
}
```

---

#### `POST /billing/cancel`

**Request Body:**

```json
{
  "organisationId": "org-abc-123",
  "immediate": false
}
```

| Field | Type | Description |
|---|---|---|
| `organisationId` | string | Organisation whose subscription to cancel |
| `immediate` | boolean | If `true`, cancels immediately. If `false` (default), cancels at end of billing period. |

**Response `200 OK`:**

```json
{
  "status": "active",
  "cancelAt": "2025-04-15T00:00:00.000Z",
  "message": "Subscription will cancel at end of billing period"
}
```

---

#### `POST /billing/resume`

Resume a subscription that has been scheduled for cancellation (before `cancelAt` date).

**Request Body:**

```json
{
  "organisationId": "org-abc-123"
}
```

**Response `200 OK`:**

```json
{
  "status": "active",
  "message": "Subscription resumed"
}
```

---

#### `GET /billing/usage`

Returns usage meters and storage breakdown for the organisation.

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `orgId` | string | Organisation ID (optional) |

**Response `200 OK`:**

```json
{
  "organisationId": "org-abc-123",
  "meters": {
    "games": { "count": 8, "limit": 25 },
    "members": { "count": 3, "limit": 5 }
  },
  "storage": {
    "totalBytes": 52428800,
    "totalMb": 50.0,
    "breakdown": {
      "assets": 30000000,
      "exports": 22428800
    }
  }
}
```

---

#### `GET /billing/entitlements`

**Response `200 OK`:**

```json
{
  "organisationId": "org-abc-123",
  "plan": "pro",
  "entitlements": {
    "max_members": 25,
    "max_storage_mb": 2048,
    "max_games": null,
    "multiplayer": true,
    "analytics": true,
    "custom_branding": true
  }
}
```

A `null` value for a limit means unlimited.

---

#### `GET /billing/upgrade-badge`

Check whether the UI should display an upgrade prompt to the player.

**Response `200 OK`:**

```json
{
  "showBadge": true,
  "currentPlan": "starter",
  "targetPlan": "pro",
  "badges": [
    {
      "feature": "games",
      "usage": 22,
      "limit": 25,
      "percent": 88
    }
  ],
  "message": "You're using 88% of your games limit"
}
```

---

### Organisations (`/organisations`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/organisations` | JWT | Create a new organisation |
| `GET` | `/organisations` | JWT | List player's organisations |
| `GET` | `/organisations/:id` | JWT | Get organisation details |
| `POST` | `/organisations/:id/members` | JWT | Add a member to the organisation |

#### `POST /organisations`

**Request Body:**

```json
{
  "name": "My Game Studio",
  "description": "We make awesome games"
}
```

**Response `201 Created`:**

```json
{
  "organisation": {
    "id": "org-abc-123",
    "name": "My Game Studio",
    "description": "We make awesome games",
    "ownerId": "abc-123",
    "createdAt": "2025-03-15T12:00:00.000Z"
  }
}
```

---

#### `POST /organisations/:id/members`

**Request Body:**

```json
{
  "playerId": "def-456",
  "role": "member"
}
```

---

### Economy (`/economy`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/economy/wallet` | JWT | Get wallet balances |
| `GET` | `/economy/transactions` | JWT | Get transaction history |
| `POST` | `/economy/earn` | JWT | Award currency to the player |
| `GET` | `/economy/store` | JWT | List store items |
| `POST` | `/economy/store/purchase` | JWT | Purchase an item from the store |
| `GET` | `/economy/inventory` | JWT | Get player's inventory |
| `GET` | `/economy/battlepass` | JWT | Get current battle pass details |
| `GET` | `/economy/battlepass/progress` | JWT | Get player's battle pass progress |
| `POST` | `/economy/battlepass/purchase` | JWT | Buy the premium battle pass (500 gems) |
| `POST` | `/economy/battlepass/claim` | JWT | Claim a tier reward |
| `POST` | `/economy/battlepass/xp` | JWT | Add battle pass XP |

#### `GET /economy/wallet`

Returns all currency balances. The platform supports three currencies: **coins**, **gems**, and **tickets**.

**Response `200 OK`:**

```json
{
  "wallets": {
    "coins": { "balance": 1500, "lifetimeEarned": 12000 },
    "gems": { "balance": 250, "lifetimeEarned": 800 },
    "tickets": { "balance": 3, "lifetimeEarned": 15 }
  }
}
```

---

#### `GET /economy/transactions`

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | 50 | Max entries (max 100) |
| `offset` | number | 0 | Pagination offset |

**Response `200 OK`:**

```json
{
  "transactions": [
    {
      "id": "tx-abc-123",
      "currency_type": "coins",
      "amount": 100,
      "balance_after": 1500,
      "tx_type": "earn",
      "source": "match_win",
      "reference_id": "match-xyz",
      "created_at": "2025-03-21T14:30:00.000Z"
    }
  ],
  "limit": 50,
  "offset": 0
}
```

---

#### `POST /economy/earn`

Award currency to a player. Used for game rewards, achievements, and daily bonuses.

**Request Body:**

```json
{
  "currencyType": "coins",
  "amount": 100,
  "source": "match_win",
  "referenceId": "match-xyz"
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `currencyType` | string | Yes | `"coins"`, `"gems"`, or `"tickets"` |
| `amount` | number | Yes | Must be greater than 0 |
| `source` | string | Yes | One of: `"match_win"`, `"battle_pass"`, `"daily_reward"`, `"achievement"`, `"admin_grant"` |
| `referenceId` | string | No | Reference identifier for auditing |

**Response `200 OK`:**

```json
{
  "message": "Earned 100 coins",
  "balance": 1500
}
```

---

#### `GET /economy/store`

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `type` | string | Filter by item type |

**Response `200 OK`:**

```json
{
  "items": [
    {
      "id": "avatar-nova",
      "name": "Nova Avatar",
      "description": "Unlock the Nova character",
      "item_type": "avatar",
      "currency_type": "gems",
      "price": 200,
      "is_active": true,
      "metadata": {}
    }
  ]
}
```

---

#### `POST /economy/store/purchase`

**Request Body:**

```json
{
  "itemId": "avatar-nova"
}
```

**Response `200 OK`:**

```json
{
  "message": "Purchased Nova Avatar",
  "item": {
    "id": "avatar-nova",
    "name": "Nova Avatar",
    "item_type": "avatar",
    "price": 200
  }
}
```

**Error Responses:**

| Status | Error | When |
|---|---|---|
| `404` | `"Item not found"` | Item does not exist or is inactive |
| `409` | `"Item already owned"` | Player already owns the item |
| `400` | `"Insufficient balance"` | Not enough currency (response includes `required` and `current` fields) |

---

#### `GET /economy/inventory`

**Response `200 OK`:**

```json
{
  "inventory": [
    {
      "item_id": "avatar-nova",
      "name": "Nova Avatar",
      "description": "Unlock the Nova character",
      "item_type": "avatar",
      "source": "store",
      "acquired_at": "2025-03-21T14:30:00.000Z",
      "metadata": {}
    }
  ]
}
```

---

#### `GET /economy/battlepass`

Returns the current active battle pass definition, or `null` if no battle pass is active.

**Response `200 OK`:**

```json
{
  "battlePass": {
    "id": "bp-spring-2025",
    "season_name": "Spring 2025",
    "season_ends_at": "2025-05-31T23:59:59.000Z",
    "max_tier": 50,
    "xp_per_tier": 1000,
    "free_rewards": [
      { "tier": 1, "reward_type": "currency", "reward_data": { "currency_type": "coins", "amount": 100 } },
      { "tier": 5, "reward_type": "item", "reward_data": { "item_id": "banner-spring" } }
    ],
    "premium_rewards": [
      { "tier": 1, "reward_type": "currency", "reward_data": { "currency_type": "gems", "amount": 50 } }
    ],
    "is_active": true
  }
}
```

---

#### `GET /economy/battlepass/progress`

**Response `200 OK`:**

```json
{
  "progress": {
    "currentTier": 12,
    "currentXp": 450,
    "xpToNextTier": 550,
    "isPremium": true,
    "claimedTiers": [1, 2, 3, 4, 5],
    "maxTier": 50,
    "xpPerTier": 1000,
    "freeRewards": [ "..." ],
    "premiumRewards": [ "..." ]
  }
}
```

---

#### `POST /economy/battlepass/purchase`

Purchase the premium battle pass track. Costs **500 gems**.

**Response `200 OK`:**

```json
{
  "message": "Premium battle pass activated"
}
```

**Error Responses:**

| Status | Error | When |
|---|---|---|
| `404` | `"No active battle pass"` | No battle pass is currently running |
| `409` | `"Already have premium battle pass"` | Player already owns premium |
| `400` | `"Insufficient gems"` | Not enough gems (response includes `required` and `current`) |

---

#### `POST /economy/battlepass/claim`

Claim a reward for a reached tier.

**Request Body:**

```json
{
  "tier": 5
}
```

**Response `200 OK`:**

```json
{
  "message": "Tier 5 rewards claimed",
  "rewards": [
    { "tier": 5, "reward_type": "item", "reward_data": { "item_id": "banner-spring" } }
  ]
}
```

**Error Responses:**

| Status | Error | When |
|---|---|---|
| `400` | `"tier is required"` | Missing tier in request body |
| `400` | `"Tier not yet reached"` | Player has not reached the requested tier |
| `404` | `"No reward at this tier"` | No reward configured for this tier |
| `409` | `"Tier already claimed"` | Reward already collected |

---

#### `POST /economy/battlepass/xp`

Add XP to the player's battle pass. Automatically handles tier-ups when XP exceeds the threshold.

**Request Body:**

```json
{
  "xp": 250,
  "source": "match_complete"
}
```

**Response `200 OK`:**

```json
{
  "progress": {
    "previousTier": 12,
    "currentTier": 13,
    "currentXp": 200,
    "xpAwarded": 250,
    "tiersGained": 1
  }
}
```

---

### Comments & Reviews (`/comments`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/comments/:gameId` | Optional | List comments for a game |
| `GET` | `/comments/:gameId/thread/:commentId` | Optional | Get a comment thread (replies) |
| `POST` | `/comments/:gameId` | JWT | Post a comment |
| `PUT` | `/comments/:commentId` | JWT | Edit own comment |
| `DELETE` | `/comments/:commentId` | JWT | Delete own comment |
| `POST` | `/comments/:commentId/report` | JWT | Report a comment |
| `GET` | `/comments/:gameId/reviews` | Optional | Get game reviews |
| `POST` | `/comments/:gameId/reviews` | JWT | Post or update a review (1 per player per game) |
| `DELETE` | `/comments/:gameId/reviews` | JWT | Delete own review |
| `POST` | `/comments/reviews/:reviewId/report` | JWT | Report a review |

#### `POST /comments/:gameId`

**Request Body:**

```json
{
  "body": "This game is amazing!",
  "parentId": null
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `body` | string | Yes | Comment text |
| `parentId` | string | No | Parent comment ID for threaded replies |

---

#### `POST /comments/:gameId/reviews`

Each player can have at most one review per game. Posting again updates the existing review.

**Request Body:**

```json
{
  "title": "Great physics simulation",
  "body": "Love the realistic ball physics and the variety of levels.",
  "rating": 5
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `title` | string | Yes | Review title |
| `body` | string | Yes | Review text |
| `rating` | number | Yes | 1-5 star rating |

---

#### `POST /comments/:commentId/report`

**Request Body:**

```json
{
  "reason": "spam"
}
```

---

### Compliance -- GDPR/CCPA (`/compliance`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/compliance/consent` | JWT | Get current consent status |
| `POST` | `/compliance/consent` | JWT | Record consent preferences |
| `POST` | `/compliance/export` | JWT | Request a data export |
| `GET` | `/compliance/export/:id` | JWT | Check data export status |
| `POST` | `/compliance/delete` | JWT | Request account data deletion |
| `GET` | `/compliance/privacy-policy` | None | Get privacy policy metadata |

#### `POST /compliance/consent`

**Request Body:**

```json
{
  "analytics": true,
  "marketing": false,
  "thirdParty": false
}
```

---

#### `POST /compliance/export`

Initiates an asynchronous data export. The export file will be available for download once processing completes.

**Response `202 Accepted`:**

```json
{
  "exportId": "export-abc-123",
  "status": "processing",
  "estimatedCompletion": "2025-03-21T15:00:00.000Z"
}
```

---

#### `GET /compliance/export/:id`

**Response `200 OK`:**

```json
{
  "exportId": "export-abc-123",
  "status": "complete",
  "downloadUrl": "https://...",
  "expiresAt": "2025-03-28T15:00:00.000Z"
}
```

---

#### `POST /compliance/delete`

Request permanent deletion of all player data. This action is irreversible.

---

#### `GET /compliance/privacy-policy`

**Response `200 OK`:**

```json
{
  "version": "2.1",
  "effectiveDate": "2025-01-01",
  "url": "https://minigames.cool/privacy",
  "lastUpdated": "2025-01-01T00:00:00.000Z"
}
```

---

### Batch Sync (`/sync`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/sync/batch` | JWT | Process a batch of queued operations |

#### `POST /sync/batch`

Process multiple queued operations in a single request. Useful for offline-first clients that accumulate operations while disconnected.

**Request Body:**

```json
{
  "operations": [
    {
      "type": "score_submit",
      "gameId": "PhysicsMasterBilliards",
      "data": { "score": 1200, "level": 2 },
      "timestamp": 1711000000000
    },
    {
      "type": "score_submit",
      "gameId": "CampusDash",
      "data": { "score": 3500 },
      "timestamp": 1711000001000
    }
  ]
}
```

Maximum **50 operations** per batch.

**Response `200 OK`:**

```json
{
  "results": [
    { "index": 0, "status": "ok", "data": { "highScore": 1200, "isNewHigh": true } },
    { "index": 1, "status": "ok", "data": { "highScore": 5200, "isNewHigh": false } }
  ],
  "processed": 2,
  "failed": 0
}
```

---

### Webhooks (`/webhooks`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/webhooks/stripe` | Stripe Signature | Handle incoming Stripe webhook events |

#### `POST /webhooks/stripe`

Receives Stripe webhook events for subscription lifecycle management. Authenticated via the `Stripe-Signature` header (not JWT).

**Handled Events:**

| Event | Action |
|---|---|
| `customer.subscription.created` | Sync new subscription to local database |
| `customer.subscription.updated` | Update subscription status and entitlements |
| `customer.subscription.deleted` | Mark subscription as canceled and downgrade entitlements |
| `invoice.payment_succeeded` | Record successful payment |
| `invoice.payment_failed` | Mark subscription as `past_due` |

This endpoint should be configured as the webhook URL in the Stripe dashboard. The endpoint verifies the `Stripe-Signature` header against the webhook signing secret.

---

### Admin (`/admin`)

All admin routes require authentication and the `requireAdmin('moderator')` middleware (or higher role as noted). Admin roles are hierarchical: `moderator` < `admin` < `super_admin`.

#### Dashboard

| Method | Path | Min Role | Description |
|---|---|---|---|
| `GET` | `/admin/stats` | moderator | Overview dashboard stats |

**Response `200 OK`:**

```json
{
  "comments": {
    "published": 150,
    "hidden": 5,
    "removed": 2,
    "flagged": 3
  },
  "reviews": {
    "published": 80,
    "hidden": 1
  },
  "reports": {
    "open": 7,
    "resolved": 45,
    "dismissed": 12
  },
  "players": {
    "total": 2500,
    "newToday": 15,
    "newThisWeek": 87
  }
}
```

#### Moderation Queue

| Method | Path | Min Role | Description |
|---|---|---|---|
| `GET` | `/admin/queue` | moderator | Items needing review (flagged comments/reviews) |
| `GET` | `/admin/reports` | moderator | Open content reports |

**`GET /admin/queue` Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | 50 | Max entries (max 100) |
| `offset` | number | 0 | Pagination offset |
| `type` | string | - | Filter: `"comment"` or `"review"` |

**`GET /admin/reports` Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `status` | string | `"open"` | Filter: `"open"`, `"resolved"`, `"dismissed"` |
| `limit` | number | 50 | Max entries (max 100) |
| `offset` | number | 0 | Pagination offset |

#### Content Moderation

| Method | Path | Min Role | Description |
|---|---|---|---|
| `POST` | `/admin/comments/:id/approve` | moderator | Approve a hidden comment |
| `POST` | `/admin/comments/:id/hide` | moderator | Hide a comment |
| `POST` | `/admin/comments/:id/remove` | moderator | Permanently remove a comment |
| `POST` | `/admin/comments/:id/restore` | moderator | Restore a removed comment |
| `POST` | `/admin/reviews/:id/approve` | moderator | Approve a hidden review |
| `POST` | `/admin/reviews/:id/hide` | moderator | Hide a review |
| `POST` | `/admin/reviews/:id/remove` | moderator | Permanently remove a review |

All moderation actions accept an optional `reason` in the request body and are logged to the audit trail.

**Request Body (optional):**

```json
{
  "reason": "Violation of community guidelines"
}
```

#### Report Resolution

| Method | Path | Min Role | Description |
|---|---|---|---|
| `POST` | `/admin/reports/:id/resolve` | moderator | Resolve a report with action |
| `POST` | `/admin/reports/:id/dismiss` | moderator | Dismiss a report |

**`POST /admin/reports/:id/resolve` Request Body:**

```json
{
  "note": "Content removed for policy violation",
  "action": "remove_content"
}
```

| `action` Value | Effect |
|---|---|
| `hide_content` | Hides the reported content |
| `remove_content` | Permanently removes the reported content |
| `warn_user` | Issues a warning to the content author |
| `no_action` | Resolves without content action |

#### User Management

| Method | Path | Min Role | Description |
|---|---|---|---|
| `GET` | `/admin/users` | moderator | List/search users |
| `GET` | `/admin/users/:id` | moderator | User details with history |
| `POST` | `/admin/users/:id/warn` | moderator | Issue a warning |
| `POST` | `/admin/users/:id/ban` | admin | Ban a user and hide all their content |
| `POST` | `/admin/users/:id/role` | super_admin | Set a user's admin role |

**`GET /admin/users` Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `search` | string | - | Search by display name or email |
| `limit` | number | 50 | Max entries (max 100) |
| `offset` | number | 0 | Pagination offset |

**`POST /admin/users/:id/role` Request Body:**

```json
{
  "role": "moderator"
}
```

Valid roles: `null` (remove role), `"moderator"`, `"admin"`, `"super_admin"`.

#### Audit Log

| Method | Path | Min Role | Description |
|---|---|---|---|
| `GET` | `/admin/log` | moderator | View moderation audit log |

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | 50 | Max entries (max 100) |
| `offset` | number | 0 | Pagination offset |

---

### Admin Games (`/admin/games`)

All routes require authentication and the `requireAdmin('admin')` middleware.

| Method | Path | Min Role | Description |
|---|---|---|---|
| `GET` | `/admin/games` | admin | List all custom games (including inactive) |
| `POST` | `/admin/games` | admin | Create a new custom game |
| `PUT` | `/admin/games/:id` | admin | Update a custom game |
| `DELETE` | `/admin/games/:id` | admin | Delete a custom game |
| `POST` | `/admin/games/:id/toggle` | admin | Toggle a game's active state |
| `GET` | `/admin/games/categories/all` | admin | List all categories (including inactive) |
| `POST` | `/admin/games/categories` | admin | Create a category |
| `PUT` | `/admin/games/categories/:id` | admin | Update a category |
| `DELETE` | `/admin/games/categories/:id` | admin | Delete a category |
| `PUT` | `/admin/games/:id/categories` | admin | Assign categories to a game |

#### `POST /admin/games`

**Request Body:**

```json
{
  "id": "MyNewGame",
  "title": "My New Game",
  "classic": "puzzle",
  "characterId": "newton",
  "mechanic": "physics",
  "iconColor": "#4A90D9",
  "iconEmoji": "🧪",
  "sceneCode": "function init() { ... }",
  "sortOrder": 50,
  "categoryIds": ["physics", "puzzle"]
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `id` | string | Yes | Must start with a letter, contain only letters/numbers/hyphens/underscores, 2-61 chars |
| `title` | string | Yes | Game display title |
| `sceneCode` | string | Yes | Game scene implementation code |
| `classic` | string | No | Classic game type |
| `characterId` | string | No | Default character |
| `mechanic` | string | No | Game mechanic type |
| `iconColor` | string | No | Hex color (default: `"#333"`) |
| `iconEmoji` | string | No | Emoji icon (default: `"?"`) |
| `sortOrder` | number | No | Sort position (default: 100) |
| `categoryIds` | string[] | No | Array of category IDs to assign |

---

#### `PUT /admin/games/:id/categories`

Replace all category assignments for a game.

**Request Body:**

```json
{
  "categoryIds": ["physics", "strategy"]
}
```

---

#### `POST /admin/games/categories`

**Request Body:**

```json
{
  "name": "Physics",
  "description": "Games involving physical simulations",
  "iconEmoji": "⚛️",
  "iconColor": "#4A90D9",
  "sortOrder": 10
}
```

---

## WebSocket Protocol

The WebSocket server provides real-time communication for multiplayer games, matchmaking, and in-game chat.

### Connection

Connect to the WebSocket endpoint with a JWT token in the query string:

```
ws://localhost:3000/ws?token=<jwt_access_token>
```

- Maximum message payload: **64 KB**
- The server sends heartbeat pings every **30 seconds**; connections that fail to respond are terminated
- If a player opens a new connection, any existing connection for that player is closed with code `4000`

### Connection Confirmation

Upon successful authentication, the server sends:

```json
{
  "type": "connected",
  "playerId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### Connection Errors

```json
{
  "type": "error",
  "message": "Authentication required"
}
```

The connection is closed with code `4001` if the token is missing or invalid.

### Message Format

All messages are JSON objects with a `type` field and additional payload fields.

### Client-to-Server Messages

#### `join_room`

Join an existing game room.

```json
{
  "type": "join_room",
  "roomId": "room-abc-123"
}
```

#### `leave_room`

Leave the current room.

```json
{
  "type": "leave_room"
}
```

#### `ready`

Toggle ready state in a room lobby.

```json
{
  "type": "ready",
  "ready": true
}
```

#### `start_game`

Start the game (host only; all players must be ready).

```json
{
  "type": "start_game"
}
```

#### `game_action`

Send an in-game action to be broadcast to all players.

```json
{
  "type": "game_action",
  "action": {
    "type": "move",
    "data": { "x": 100, "y": 200 }
  }
}
```

#### `chat`

Send a chat message to the room (max 500 characters).

```json
{
  "type": "chat",
  "message": "Good luck everyone!"
}
```

#### `queue_ranked`

Enter the ranked matchmaking queue.

```json
{
  "type": "queue_ranked",
  "gameId": "PhysicsMasterBilliards",
  "skillRating": 1200,
  "skillDeviation": 200,
  "region": "us-east",
  "mode": "ranked",
  "maxPlayers": 2
}
```

| Field | Default | Description |
|---|---|---|
| `gameId` | (required) | Game to matchmake for |
| `skillRating` | 1000 | Player's Glicko/Elo rating |
| `skillDeviation` | 350 | Rating uncertainty |
| `region` | `"us-east"` | Preferred region |
| `mode` | `"ranked"` | Match mode |
| `maxPlayers` | 2 | Players per match |

#### `cancel_queue`

Leave the matchmaking queue.

```json
{
  "type": "cancel_queue"
}
```

#### `friend_invite`

Invite an online friend to your room.

```json
{
  "type": "friend_invite",
  "friendId": "def-456",
  "roomId": "room-abc-123",
  "gameId": "PhysicsMasterBilliards"
}
```

#### `ping`

Client-initiated ping for latency measurement.

```json
{
  "type": "ping"
}
```

### Server-to-Client Messages

#### `connected`

Sent immediately after successful authentication.

```json
{
  "type": "connected",
  "playerId": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### `room_update`

Sent whenever room state changes (player joins/leaves, readiness changes, etc.).

```json
{
  "type": "room_update",
  "room": {
    "id": "room-abc-123",
    "gameId": "PhysicsMasterBilliards",
    "state": "waiting",
    "players": [
      { "id": "abc-123", "displayName": "Host", "avatar": "guha", "ready": true },
      { "id": "def-456", "displayName": "Guest", "avatar": "nova", "ready": false }
    ],
    "host": "abc-123"
  }
}
```

#### `player_joined`

Broadcast when a new player enters the room.

```json
{
  "type": "player_joined",
  "player": {
    "id": "def-456",
    "displayName": "Guest",
    "avatar": "nova"
  }
}
```

#### `player_left`

Broadcast when a player leaves the room.

```json
{
  "type": "player_left",
  "playerId": "def-456"
}
```

#### `game_started`

Broadcast when the host starts the game.

```json
{
  "type": "game_started",
  "room": { "..." },
  "gameState": {
    "..."
  }
}
```

#### `game_action`

Broadcast of another player's in-game action.

```json
{
  "type": "game_action",
  "playerId": "abc-123",
  "result": {
    "type": "move",
    "data": { "x": 100, "y": 200 }
  }
}
```

#### `game_over`

Broadcast when the game ends with final scores.

```json
{
  "type": "game_over",
  "scores": [
    { "playerId": "abc-123", "score": 1500, "placement": 1 },
    { "playerId": "def-456", "score": 1200, "placement": 2 }
  ]
}
```

#### `chat`

A chat message from another player in the room.

```json
{
  "type": "chat",
  "playerId": "abc-123",
  "displayName": "Host",
  "message": "Good luck everyone!"
}
```

#### `match_found`

Sent when ranked matchmaking finds a match.

```json
{
  "type": "match_found",
  "matchId": "match-xyz",
  "room": { "..." },
  "players": [
    { "id": "abc-123", "displayName": "Player1", "skillRating": 1200, "region": "us-east" },
    { "id": "def-456", "displayName": "Player2", "skillRating": 1180, "region": "us-east" }
  ]
}
```

#### `queue_joined`

Confirmation of joining the matchmaking queue.

```json
{
  "type": "queue_joined",
  "gameId": "PhysicsMasterBilliards",
  "estimatedWait": 15,
  "position": 3
}
```

#### `queue_cancelled`

Confirmation of leaving the matchmaking queue.

```json
{
  "type": "queue_cancelled"
}
```

#### `friend_invite`

Received when another player invites you to a room.

```json
{
  "type": "friend_invite",
  "from": { "id": "abc-123", "displayName": "FriendName" },
  "roomId": "room-abc-123",
  "gameId": "PhysicsMasterBilliards"
}
```

#### `invite_sent`

Confirmation that your friend invite was delivered.

```json
{
  "type": "invite_sent",
  "to": "def-456"
}
```

#### `pong`

Response to a client `ping`.

```json
{
  "type": "pong",
  "serverTime": 1711000000000
}
```

#### `error`

Sent when a message cannot be processed.

```json
{
  "type": "error",
  "message": "Room is full"
}
```

### WebSocket Close Codes

| Code | Reason |
|---|---|
| `4000` | Replaced by new connection |
| `4001` | Authentication failure (no token or invalid token) |

---

## Subscription Plans

| Plan | Price | Team Members | Storage | Custom Games |
|---|---|---|---|---|
| **Free** | $0/month | 1 | 50 MB | 5 |
| **Starter** | $19.99/month | 5 | 500 MB | 25 |
| **Pro** | $49.99/month | 25 | 2 GB | Unlimited |
| **Enterprise** | $149.99/month | Unlimited | 10 GB | Unlimited |

- A **14-day free trial** is available for any paid plan (one trial per user).
- Subscriptions are managed through Stripe. Players can manage payment methods and view invoices through the billing portal (`POST /billing/portal`).
- Downgrading happens at the end of the current billing period. Upgrading takes effect immediately.
- Usage-based upgrade badges appear when any meter reaches 80% of the plan limit.
