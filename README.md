# STEM School Adventures

**[minigames.cool](https://minigames.cool)**

A multi-tenant STEM gaming platform with 25 educational minigames. Four-layer architecture: React UI, Rust/Bevy game engine (WASM), Rust/Axum action backend on Shuttle.dev, and PostgreSQL persistence. Features game categories, multiplayer, subscription billing, leaderboards, and admin game management.

## Architecture

| Layer | Technology | Purpose |
|---|---|---|
| **UI / Menu** | React (Vite + TypeScript) | Fast iteration on menus, auth, billing, lobby |
| **Game Engine** | Rust / Bevy (compiled to WASM) | High-performance game rendering and physics |
| **Backend Action** | Rust / Axum (hosted on Shuttle.dev) | Zero-lag API, multiplayer, real-time actions |
| **Backend Persistence** | PostgreSQL + Redis | Player data, leaderboards, subscriptions |

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
├── client/                    # React frontend (Vite + TypeScript)
│   ├── src/
│   │   ├── components/       # UI components (NavBar, GameGrid, GameView, modals)
│   │   ├── api/              # API client with JWT management
│   │   ├── stores/           # Player and game state (React context)
│   │   └── main.tsx          # Entry point
│   ├── public/wasm/          # Built WASM game engine output
│   └── package.json
├── game-engine/              # Bevy game engine (Rust → WASM)
│   ├── src/
│   │   ├── lib.rs            # WASM entry, Bevy app, JS bridge
│   │   └── games/            # Game implementations (campus_dash, etc.)
│   ├── build.sh              # WASM build script
│   └── Cargo.toml
├── server-rs/                # Axum API backend (Shuttle.dev)
│   ├── src/
│   │   ├── main.rs           # Router, Shuttle entry point
│   │   ├── routes/           # 18 route modules
│   │   ├── middleware/        # Auth, rate limiting, tenancy, entitlements
│   │   ├── models/           # Database entities (serde + sqlx)
│   │   ├── services/         # Stripe, leaderboards, achievements, rooms
│   │   ├── cache.rs          # Redis wrapper
│   │   ├── config.rs         # Environment configuration
│   │   ├── db.rs             # PostgreSQL pool initialization
│   │   └── error.rs          # Custom error types
│   ├── Shuttle.toml          # Shuttle deployment config
│   └── Cargo.toml
├── db/migrations/            # 7 PostgreSQL migrations
├── Cargo.toml                # Workspace (server-rs + game-engine)
└── vercel.json               # Vercel config (static frontend only)
```

## Quick Start

### Prerequisites

- Rust 1.75+ (with `cargo`, `wasm32-unknown-unknown` target, `wasm-bindgen-cli`)
- Node.js 18+
- PostgreSQL 14+
- Redis 7+
- [Shuttle CLI](https://docs.shuttle.dev) (`cargo install cargo-shuttle`)
- [Stripe](https://stripe.com) account (for billing)

### Local Development

```bash
# Clone
git clone <your-repo-url>
cd minigames

# Configure environment
cp server-rs/.env.example server-rs/.env
# Edit .env with your database, Redis, and Stripe credentials

# Run database migrations
psql $DATABASE_URL -f db/migrations/001_initial_schema.sql
# ... (see Deploy section for all migrations)

# Build game engine (WASM)
cd game-engine && ./build.sh

# Start backend (Shuttle local dev)
cd server-rs && cargo shuttle run

# Start frontend (in another terminal)
cd client && npm install && npm run dev
```

Frontend dev server at `http://localhost:5173`, API at `http://localhost:8000/api/v1/*`.

## Deploy

### Backend → Shuttle.dev

```bash
# Install Shuttle CLI
cargo install cargo-shuttle

# Login
cargo shuttle login

# Deploy
cd server-rs && cargo shuttle deploy
```

The backend runs as a persistent Rust process on Shuttle (not serverless), which means WebSocket connections and in-memory state work natively.

Set secrets via `cargo shuttle secrets set`:
```bash
DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
JWT_SECRET
CORS_ORIGINS=https://minigames.cool
DEFAULT_TENANT_ID=stem_default
STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO, STRIPE_PRICE_ENTERPRISE
```

### Frontend → Vercel

```bash
# Build game engine WASM first
cd game-engine && ./build.sh

# Deploy
vercel link
vercel --prod
```

Vercel serves the React static build and proxies `/api/*` requests to the Shuttle backend.

### Database Migrations

```bash
psql $DATABASE_URL -f db/migrations/001_initial_schema.sql
psql $DATABASE_URL -f db/migrations/002_subscriptions_billing.sql
psql $DATABASE_URL -f db/migrations/003_comments_reviews_moderation.sql
psql $DATABASE_URL -f db/migrations/004_multiplayer.sql
psql $DATABASE_URL -f db/migrations/005_custom_games.sql
psql $DATABASE_URL -f db/migrations/006_multiplayer_tech_stack.sql
psql $DATABASE_URL -f db/migrations/007_game_categories.sql
```

### Stripe Webhooks

Create a webhook endpoint at `https://stem-adventures-api.shuttle.app/api/v1/webhooks/stripe` with events:
- `customer.subscription.created`, `.updated`, `.deleted`
- `invoice.payment_succeeded`, `.payment_failed`
- `customer.subscription.trial_will_end`
- `checkout.session.completed`

### Domain (GoDaddy → Vercel)

| Type | Name | Value |
|---|---|---|
| A | @ | `76.76.21.21` |
| CNAME | www | `cname.vercel-dns.com` |

## API Reference

See [docs/API.md](docs/API.md) for the complete API reference.

### Key Endpoints

| Route | Auth | Description |
|---|---|---|
| `POST /api/v1/auth/register` | - | Register player |
| `POST /api/v1/auth/login` | - | Login (JWT) |
| `GET /api/v1/games/categories` | - | List game categories |
| `POST /api/v1/scores` | JWT | Submit score |
| `GET /api/v1/leaderboards/:gameId/ranked` | Optional | Ranked leaderboard |
| `GET /api/v1/billing/status` | JWT | Subscription status |
| `POST /api/v1/multiplayer/rooms` | JWT | Create game room |
| `WS /ws` | Token | Real-time game WebSocket |
| `GET /api/v1/health` | - | Health check |

## Testing

```bash
cd server-rs && cargo test
cd client && npm test
```

## Tech Stack

| Layer | Technology |
|---|---|
| UI / Menu | React 18, Vite, TypeScript |
| Game Engine | Bevy 0.15, Rust → WASM (WebGL2) |
| Backend API | Rust, Axum 0.7, Tower, Tokio |
| Hosting (API) | Shuttle.dev (persistent Rust process) |
| Hosting (UI) | Vercel (static) |
| Database | PostgreSQL 14+ (SQLx) |
| Cache | Redis 7+ (sorted sets for leaderboards) |
| Billing | Stripe (subscriptions, webhooks) |
| Realtime | WebSocket (native, persistent on Shuttle) |
| Domain | GoDaddy DNS → Vercel |

## Browser Support

- Chrome 90+ (primary target, WebGL2)
- Firefox 90+
- Safari 15+
- Edge 90+

## License

Proprietary. All rights reserved.
