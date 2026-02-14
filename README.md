# STEM School Adventures

**[minigames.cool](https://minigames.cool)**

A multi-tenant STEM gaming platform with 25 educational minigames, built with Phaser 3 and a Rust (Axum) API backend. Features game categories, multiplayer, subscription billing, leaderboards, and admin game management. Hosted on Vercel with a custom domain.

## Features

- **25 Educational Games** covering physics, chemistry, engineering, biology, computer science, and more
- **Game Categories** with filterable tabs and grouped display
- **Multiplayer** with WebSocket rooms, matchmaking, and real-time gameplay
- **Subscription Billing** via Stripe (Free, Starter, Pro, Enterprise tiers)
- **Leaderboards** with sharded Redis caching and seasonal rankings
- **Admin Panel** for managing custom games and categories
- **Cloud Save** with offline-first local storage and server sync
- **Multi-Tenant** architecture for white-label deployments
- **SEO Optimized** with Open Graph, Twitter Cards, JSON-LD structured data
- **WCAG AA Accessible** with keyboard navigation, ARIA roles, screen reader support, reduced motion
- **In-Game Economy** with virtual currency wallet and battle pass

## Project Structure

```
minigames/
├── assets/svg/               # 12 character SVG sprites
├── css/styles.css            # Global styles (responsive, accessible)
├── js/
│   ├── engine/               # Game engine core (7 modules)
│   │   ├── BootScene.js      # Universal boot/preload scene
│   │   ├── CharacterFactory.js # Character sprite generator
│   │   ├── CloudSyncAPI.js   # Cloud save/sync client
│   │   ├── GameRegistry.js   # Game + category registry
│   │   ├── Launcher.js       # Game grid UI + Phaser launcher
│   │   ├── MultiplayerClient.js # WebSocket game client
│   │   └── SaveManager.js    # Local + cloud save manager
│   ├── games/                # 25 Phaser game scene modules
│   ├── admin-games.js        # Admin game/category management UI
│   ├── lobby-ui.js           # Multiplayer lobby UI
│   └── site-ui.js            # Auth, billing, modal management
├── server-rs/                # Rust (Axum) API backend
│   ├── src/
│   │   ├── main.rs           # Router, handler, app state
│   │   ├── routes/           # 18 route modules
│   │   ├── middleware/        # Auth, rate limiting, tenancy, entitlements
│   │   ├── models/           # Database entities (serde + sqlx)
│   │   ├── services/         # Stripe, leaderboards, achievements, rooms
│   │   ├── cache.rs          # Redis wrapper
│   │   ├── config.rs         # Environment configuration
│   │   ├── db.rs             # PostgreSQL pool initialization
│   │   └── error.rs          # Custom error types
│   └── Cargo.toml            # Rust dependencies
├── admin/                    # Admin console SPA
├── db/migrations/            # 7 PostgreSQL migrations
├── docs/                     # Project documentation
├── setup.sh                  # Automated Vercel deployment script
├── vercel.json               # Vercel deployment config (vercel-rust)
└── package.json              # Root package
```

## Quick Start

### Prerequisites

- Rust 1.75+ (with `cargo`)
- PostgreSQL 14+
- Redis 7+
- [Stripe](https://stripe.com) account (for billing)

### Local Development

```bash
# Clone
git clone <your-repo-url>
cd minigames

# Configure environment
cp server-rs/.env.example server-rs/.env
# Edit .env with your database, Redis, and Stripe credentials

# Run migrations
psql $DATABASE_URL -f db/migrations/001_initial_schema.sql
# ... (see Deploy section for all migrations)

# Start dev server
cd server-rs && cargo run

# Or use the automated setup
./setup.sh
```

The API serves at `/api/v1/*` and the WebSocket server at `ws://localhost:3000/ws`.

## Deploy to Vercel

### 1. Provision Infrastructure

You need:
- **PostgreSQL** database (e.g. [Neon](https://neon.tech), [Supabase](https://supabase.com), or [Vercel Postgres](https://vercel.com/storage/postgres))
- **Redis** instance (e.g. [Upstash](https://upstash.com) or [Vercel KV](https://vercel.com/storage/kv))
- **Stripe** account with products/prices configured

### 2. Run Database Migrations

```bash
psql $DATABASE_URL -f db/migrations/001_initial_schema.sql
psql $DATABASE_URL -f db/migrations/002_subscriptions_billing.sql
psql $DATABASE_URL -f db/migrations/003_comments_reviews_moderation.sql
psql $DATABASE_URL -f db/migrations/004_multiplayer.sql
psql $DATABASE_URL -f db/migrations/005_custom_games.sql
psql $DATABASE_URL -f db/migrations/006_multiplayer_tech_stack.sql
psql $DATABASE_URL -f db/migrations/007_game_categories.sql
```

Or use the automated setup script: `./setup.sh`

### 3. Configure Environment Variables

Set the following in the Vercel dashboard (**Settings > Environment Variables**):

```bash
# PostgreSQL
DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD

# Redis
REDIS_HOST, REDIS_PORT, REDIS_PASSWORD

# JWT
JWT_SECRET

# CORS
CORS_ORIGINS=https://minigames.cool

# Multi-tenancy
DEFAULT_TENANT_ID=stem_default

# Stripe
STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO, STRIPE_PRICE_ENTERPRISE
```

See `server-rs/.env.example` for the full list with defaults.

### 4. Deploy

```bash
vercel link        # First time: link to your Vercel project
vercel             # Deploy to preview
vercel --prod      # Deploy to production
```

### 5. Connect Domain (GoDaddy)

| Type | Name | Value |
|---|---|---|
| A | @ | `76.76.21.21` |
| CNAME | www | `cname.vercel-dns.com` |

### 6. Configure Stripe Webhooks

Create a webhook endpoint at `https://minigames.cool/api/v1/webhooks/stripe` with events:
- `customer.subscription.created`, `.updated`, `.deleted`
- `invoice.payment_succeeded`, `.payment_failed`
- `customer.subscription.trial_will_end`
- `checkout.session.completed`

### Multiplayer (WebSocket)

WebSockets require a persistent server. Deploy the server separately to Railway, Fly.io, or Render and set the `WS_URL` environment variable. Vercel handles REST API + static frontend.

### Deployment Details

| Setting | Value |
|---|---|
| Framework | None (static + serverless Rust) |
| Build | `vercel-rust` builder via `server-rs/Cargo.toml` |
| API route | `/api/v1/*` → `server-rs` |
| Health/Metrics | `/health`, `/metrics` → `server-rs` |
| Domain | `minigames.cool` (GoDaddy → Vercel) |

## API Reference

See [docs/API.md](docs/API.md) for the complete API reference.

### Key Endpoints

| Route | Auth | Description |
|---|---|---|
| `POST /api/v1/auth/register` | - | Register player |
| `POST /api/v1/auth/login` | - | Login (JWT) |
| `GET /api/v1/games/categories` | - | List game categories |
| `GET /api/v1/games/custom` | - | List custom games |
| `POST /api/v1/scores` | JWT | Submit score |
| `GET /api/v1/leaderboards/:gameId/ranked` | Optional | Ranked leaderboard |
| `GET /api/v1/billing/status` | JWT | Subscription status |
| `POST /api/v1/billing/subscribe` | JWT | Start subscription |
| `POST /api/v1/multiplayer/rooms` | JWT | Create game room |
| `GET /api/v1/multiplayer/rooms` | JWT | List open rooms |
| `WS /ws` | Token | Real-time game WebSocket |
| `GET /api/v1/health` | - | Health check |

## Game Development

See [docs/GAME_DEVELOPMENT.md](docs/GAME_DEVELOPMENT.md) for how to create new games.

### Game Registration Pattern

```javascript
class MyGame extends Phaser.Scene {
    constructor() { super({ key: 'MyGame' }); }
    create() { /* setup */ }
    update() { /* game loop */ }
    shutdown() { /* cleanup arrays */ }
}

GameRegistry.register({
    id: 'MyGame',
    title: 'My Game',
    classic: 'Reference Game',
    character: 'guha',
    mechanic: 'Short description',
    iconColor: '#333',
    iconEmoji: '🎮',
    scene: MyGame,
    physics: 'matter' // optional: 'matter' | 'arcade' | omit for none
});
```

## Performance

See [docs/PERFORMANCE.md](docs/PERFORMANCE.md) for optimization guidelines.

Key optimizations applied:
- Per-game physics engine loading (only Matter.js for billiards, none for others)
- Binary search for terrain height lookups (O(log n) vs O(n))
- Throttled DOM score updates (only on change)
- Static background rendering (drawn once, not per-frame)
- Scene shutdown cleanup methods

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system design details.

## Tech Stack

| Layer | Technology |
|---|---|
| Game Engine | Phaser 3.60.0 (WebGL/Canvas) |
| Frontend | Vanilla JS, CSS3 |
| Backend | Rust (Axum 0.7, Tower, Tokio) |
| Database | PostgreSQL 14+ (SQLx async driver) |
| Cache | Redis 7+ (sorted sets for leaderboards) |
| Billing | Stripe (subscriptions, webhooks) |
| Realtime | WebSocket |
| Hosting | Vercel (vercel-rust serverless) |
| Domain | GoDaddy DNS → Vercel |

## Testing

```bash
cd server-rs && cargo test
```

Tests cover: billing, entitlements, organisations, storage quotas, Stripe service, subscription sync, usage meters, webhooks.

## Browser Support

- Chrome 90+ (primary target)
- Firefox 90+
- Safari 15+
- Edge 90+

Phaser 3.60 uses WebGL with Canvas fallback. All CSS uses standard properties with `backdrop-filter` having wide support. `-webkit-background-clip` is prefixed for gradient text.

## License

Proprietary. All rights reserved.
