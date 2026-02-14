# STEM School Adventures

**[minigames.cool](https://minigames.cool)**

A multi-tenant STEM gaming platform with 25 educational minigames, built with Phaser 3 and an Express.js API backend. Hosted on Vercel with a custom domain on GoDaddy.

## Project Structure

```
minigames/
├── api/index.js              # Vercel serverless entry point
├── assets/svg/               # 12 character SVG sprites
├── js/                       # Phaser game engine + 25 game modules
├── server/                   # Express.js API backend
│   ├── config/               # App configuration
│   ├── middleware/            # Auth, entitlements, admin, rate limiting
│   ├── routes/               # API route handlers
│   ├── services/             # Stripe, subscriptions, usage meters, storage
│   └── tests/                # Test suite (89 tests)
├── admin/                    # Admin console SPA
├── db/migrations/            # PostgreSQL migrations
├── vercel.json               # Vercel deployment config
└── package.json              # Root package
```

## Deploy to Vercel

### Prerequisites

- A [Vercel](https://vercel.com) account
- [Vercel CLI](https://vercel.com/docs/cli) installed (`npm i -g vercel`)
- A PostgreSQL database (e.g. [Neon](https://neon.tech), [Supabase](https://supabase.com), or [Vercel Postgres](https://vercel.com/storage/postgres))
- A Redis instance (e.g. [Upstash](https://upstash.com) or [Vercel KV](https://vercel.com/storage/kv))
- A [Stripe](https://stripe.com) account (for billing features)

### 1. Clone and install

```bash
git clone <your-repo-url>
cd minigames
cd server && npm install
```

### 2. Run database migrations

Connect to your PostgreSQL database and run the migrations in order:

```bash
psql $DATABASE_URL -f db/migrations/001_initial_schema.sql
psql $DATABASE_URL -f db/migrations/002_subscriptions_billing.sql
psql $DATABASE_URL -f db/migrations/003_comments_reviews_moderation.sql
psql $DATABASE_URL -f db/migrations/004_multiplayer.sql
```

### 3. Configure environment variables

Set the following environment variables in the Vercel dashboard (**Settings > Environment Variables**) or via the CLI:

```bash
# PostgreSQL
vercel env add DB_HOST
vercel env add DB_PORT
vercel env add DB_NAME
vercel env add DB_USER
vercel env add DB_PASSWORD

# Redis
vercel env add REDIS_HOST
vercel env add REDIS_PORT
vercel env add REDIS_PASSWORD

# JWT
vercel env add JWT_SECRET

# CORS
vercel env add CORS_ORIGINS          # https://minigames.cool

# Multi-tenancy
vercel env add DEFAULT_TENANT_ID     # e.g. stem_default

# Stripe
vercel env add STRIPE_SECRET_KEY
vercel env add STRIPE_PUBLISHABLE_KEY
vercel env add STRIPE_WEBHOOK_SECRET
vercel env add STRIPE_PRICING_TABLE_ID
vercel env add STRIPE_PRICE_STARTER
vercel env add STRIPE_PRICE_PRO
vercel env add STRIPE_PRICE_ENTERPRISE
```

See `server/.env.example` for the full list of available variables and defaults.

### 4. Deploy

```bash
# Link to your Vercel project (first time only)
vercel link

# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

### 5. Connect custom domain (GoDaddy)

The production domain is **minigames.cool**, registered on [GoDaddy](https://godaddy.com).

1. In the Vercel dashboard go to **Settings > Domains** and add `minigames.cool`.
2. Vercel will show the required DNS records. In GoDaddy DNS Management:

| Type | Name | Value |
|---|---|---|
| A | @ | `76.76.21.21` |
| CNAME | www | `cname.vercel-dns.com` |

3. Remove any conflicting A or CNAME records for `@` and `www` in GoDaddy.
4. Wait for DNS propagation (usually a few minutes, up to 48 hours).
5. Vercel will automatically provision an SSL certificate once DNS resolves.

### 6. Set up Stripe webhooks

After deploying, create a webhook endpoint in the [Stripe Dashboard](https://dashboard.stripe.com/webhooks):

- **Endpoint URL**: `https://minigames.cool/api/v1/webhooks/stripe`
- **Events to listen for**:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
  - `customer.subscription.trial_will_end`
  - `checkout.session.completed`

Update the `STRIPE_WEBHOOK_SECRET` environment variable with the signing secret from the new endpoint.

### Deployment details

| Setting | Value |
|---|---|
| Framework | None (static + serverless) |
| Build command | _(empty)_ |
| Install command | `cd server && npm install` |
| Function memory | 512 MB |
| Function timeout | 30 seconds |
| API route | `/api/v1/*` rewrites to `api/index.js` |
| Custom domain | `minigames.cool` (GoDaddy DNS → Vercel) |

The Express app uses lazy initialization for database and Redis connections, so cold starts only connect on the first request. Connections persist across warm function invocations.

### Multiplayer (WebSocket server)

The multiplayer system uses WebSockets for real-time game communication. In local development, the WebSocket server attaches automatically to the Express HTTP server on `/ws`.

For production, WebSockets require a persistent server (not serverless). Deploy the server to a platform that supports long-lived connections (e.g. Railway, Fly.io, Render, or a VPS) and point the `WS_URL` environment variable to it. The Vercel deployment handles the REST API and static frontend; the WebSocket server runs separately.

## Local Development

```bash
# Copy env template
cp server/.env.example server/.env
# Edit server/.env with your local values

# Install dependencies
cd server && npm install

# Start the dev server
npm run dev

# Run tests
npm test
```

## API Endpoints

| Route | Description |
|---|---|
| `POST /api/v1/auth/register` | Register a new player |
| `POST /api/v1/auth/login` | Login and receive JWT |
| `POST /api/v1/scores` | Submit a game score |
| `GET /api/v1/leaderboard/:gameId` | Get leaderboard |
| `GET /api/v1/billing/plans` | List subscription plans |
| `POST /api/v1/billing/subscribe` | Start a subscription |
| `GET /api/v1/billing/status` | Get subscription status |
| `POST /api/v1/billing/portal` | Create Stripe billing portal session |
| `GET /api/v1/comments/:gameId` | Get comments for a game |
| `POST /api/v1/comments/:gameId` | Post a comment |
| `GET /api/v1/admin/dashboard` | Admin dashboard stats |
