#!/usr/bin/env bash
# =============================================================
# STEM School Adventures - Vercel Deployment Setup Script
# =============================================================
# This script automates:
#   1. Vercel project linking
#   2. Vercel Postgres + KV (Redis) creation
#   3. Database migrations
#   4. Environment variable configuration
#   5. Deployment
#
# Prerequisites:
#   - Node.js 18+
#   - Vercel CLI: npm i -g vercel
#   - psql (PostgreSQL client): brew install libpq / apt install postgresql-client
#   - Logged into Vercel: vercel login
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh
# =============================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_step() { echo -e "\n${BLUE}==>${NC} ${1}"; }
print_ok()   { echo -e "  ${GREEN}✓${NC} ${1}"; }
print_warn() { echo -e "  ${YELLOW}!${NC} ${1}"; }
print_err()  { echo -e "  ${RED}✗${NC} ${1}"; }

# -----------------------------------------------------------
# Pre-flight checks
# -----------------------------------------------------------
print_step "Checking prerequisites..."

command -v vercel >/dev/null 2>&1 || { print_err "vercel CLI not found. Install with: npm i -g vercel"; exit 1; }
command -v psql >/dev/null 2>&1   || { print_err "psql not found. Install postgresql-client for your OS"; exit 1; }
command -v node >/dev/null 2>&1   || { print_err "node not found. Install Node.js 18+"; exit 1; }

NODE_VER=$(node -v | cut -d'.' -f1 | tr -d 'v')
if [ "$NODE_VER" -lt 18 ]; then
    print_err "Node.js 18+ required (found v${NODE_VER})"
    exit 1
fi
print_ok "All prerequisites met"

# -----------------------------------------------------------
# Step 1: Link Vercel project
# -----------------------------------------------------------
print_step "Step 1/6: Linking Vercel project..."

if [ -d ".vercel" ]; then
    print_ok "Already linked (remove .vercel/ to re-link)"
else
    vercel link
    print_ok "Project linked"
fi

# -----------------------------------------------------------
# Step 2: Create Vercel storage (Postgres + KV)
# -----------------------------------------------------------
print_step "Step 2/6: Creating Vercel storage..."

echo ""
echo "  This will create two storage instances on your Vercel account."
echo "  If they already exist, you can skip this step."
echo ""
read -rp "  Create Vercel Postgres database? (y/n): " CREATE_PG
if [[ "$CREATE_PG" =~ ^[Yy]$ ]]; then
    print_step "Creating Postgres database..."
    vercel storage create postgres --name stem-adventures-db || {
        print_warn "Postgres creation failed - it may already exist. Continuing..."
    }
    print_ok "Postgres ready"
fi

read -rp "  Create Vercel KV (Redis) store? (y/n): " CREATE_KV
if [[ "$CREATE_KV" =~ ^[Yy]$ ]]; then
    print_step "Creating KV store..."
    vercel storage create kv --name stem-adventures-kv || {
        print_warn "KV creation failed - it may already exist. Continuing..."
    }
    print_ok "KV ready"
fi

# -----------------------------------------------------------
# Step 3: Pull environment variables
# -----------------------------------------------------------
print_step "Step 3/6: Pulling environment variables..."

vercel env pull .env.vercel 2>/dev/null || true
print_ok "Env vars saved to .env.vercel"

# Try to extract POSTGRES_URL from pulled env
POSTGRES_URL=""
if [ -f ".env.vercel" ]; then
    POSTGRES_URL=$(grep -E '^POSTGRES_URL=' .env.vercel 2>/dev/null | cut -d'=' -f2- | tr -d '"' || true)
fi

if [ -z "$POSTGRES_URL" ]; then
    print_warn "POSTGRES_URL not found in pulled env vars."
    read -rp "  Enter your PostgreSQL connection URL (postgres://...): " POSTGRES_URL
fi

if [ -z "$POSTGRES_URL" ]; then
    print_err "No database URL provided. Cannot run migrations."
    exit 1
fi
print_ok "Database URL configured"

# -----------------------------------------------------------
# Step 4: Run database migrations
# -----------------------------------------------------------
print_step "Step 4/6: Running database migrations..."

MIGRATION_DIR="db/migrations"
MIGRATION_FILES=(
    "001_initial_schema.sql"
    "002_subscriptions_billing.sql"
    "003_comments_reviews_moderation.sql"
    "004_multiplayer.sql"
    "005_custom_games.sql"
    "006_multiplayer_tech_stack.sql"
    "007_game_categories.sql"
)

FAILED=0
for file in "${MIGRATION_FILES[@]}"; do
    filepath="${MIGRATION_DIR}/${file}"
    if [ -f "$filepath" ]; then
        if psql "$POSTGRES_URL" -f "$filepath" > /dev/null 2>&1; then
            print_ok "Applied ${file}"
        else
            print_warn "Failed or already applied: ${file}"
            FAILED=$((FAILED + 1))
        fi
    else
        print_err "Missing: ${filepath}"
        FAILED=$((FAILED + 1))
    fi
done

if [ "$FAILED" -eq 0 ]; then
    print_ok "All migrations applied successfully"
else
    print_warn "${FAILED} migration(s) had warnings (may already be applied)"
fi

# -----------------------------------------------------------
# Step 5: Set remaining environment variables
# -----------------------------------------------------------
print_step "Step 5/6: Configuring environment variables..."

echo ""
echo "  Vercel Postgres and KV vars are set automatically."
echo "  You still need to configure JWT and optionally Stripe."
echo ""

# JWT Secret
JWT_SECRET=$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)
echo ""
read -rp "  Use auto-generated JWT secret? (y/n): " USE_AUTO_JWT
if [[ "$USE_AUTO_JWT" =~ ^[Yy]$ ]]; then
    echo "$JWT_SECRET" | vercel env add JWT_SECRET production preview development 2>/dev/null || {
        print_warn "JWT_SECRET may already be set"
    }
    print_ok "JWT_SECRET set"
else
    print_warn "Set JWT_SECRET manually: vercel env add JWT_SECRET"
fi

# Default tenant
echo "stem_default" | vercel env add DEFAULT_TENANT_ID production preview development 2>/dev/null || {
    print_warn "DEFAULT_TENANT_ID may already be set"
}
print_ok "DEFAULT_TENANT_ID set"

# CORS origins
echo ""
read -rp "  Enter your production domain (e.g. https://minigames.cool): " PROD_DOMAIN
if [ -n "$PROD_DOMAIN" ]; then
    echo "$PROD_DOMAIN" | vercel env add CORS_ORIGINS production 2>/dev/null || {
        print_warn "CORS_ORIGINS may already be set"
    }
    print_ok "CORS_ORIGINS set to ${PROD_DOMAIN}"
fi

# Stripe (optional)
echo ""
echo "  Stripe is optional. The app works without it (free tier only)."
read -rp "  Configure Stripe keys now? (y/n): " SETUP_STRIPE
if [[ "$SETUP_STRIPE" =~ ^[Yy]$ ]]; then
    read -rp "    Stripe Secret Key (sk_test_...): " STRIPE_SK
    read -rp "    Stripe Publishable Key (pk_test_...): " STRIPE_PK
    read -rp "    Stripe Webhook Secret (whsec_...): " STRIPE_WH

    if [ -n "$STRIPE_SK" ]; then
        echo "$STRIPE_SK" | vercel env add STRIPE_SECRET_KEY production preview development 2>/dev/null || true
        print_ok "STRIPE_SECRET_KEY set"
    fi
    if [ -n "$STRIPE_PK" ]; then
        echo "$STRIPE_PK" | vercel env add STRIPE_PUBLISHABLE_KEY production preview development 2>/dev/null || true
        print_ok "STRIPE_PUBLISHABLE_KEY set"
    fi
    if [ -n "$STRIPE_WH" ]; then
        echo "$STRIPE_WH" | vercel env add STRIPE_WEBHOOK_SECRET production preview development 2>/dev/null || true
        print_ok "STRIPE_WEBHOOK_SECRET set"
    fi

    read -rp "    Stripe Price ID - Starter (price_...): " PRICE_STARTER
    read -rp "    Stripe Price ID - Pro (price_...): " PRICE_PRO
    read -rp "    Stripe Price ID - Enterprise (price_...): " PRICE_ENT

    [ -n "$PRICE_STARTER" ] && echo "$PRICE_STARTER" | vercel env add STRIPE_PRICE_STARTER production preview development 2>/dev/null || true
    [ -n "$PRICE_PRO" ] && echo "$PRICE_PRO" | vercel env add STRIPE_PRICE_PRO production preview development 2>/dev/null || true
    [ -n "$PRICE_ENT" ] && echo "$PRICE_ENT" | vercel env add STRIPE_PRICE_ENTERPRISE production preview development 2>/dev/null || true
    print_ok "Stripe configuration complete"
else
    print_warn "Skipping Stripe - app will run in free-tier-only mode"
fi

# -----------------------------------------------------------
# Step 6: Deploy
# -----------------------------------------------------------
print_step "Step 6/6: Deploying to Vercel..."

echo ""
read -rp "  Deploy to production now? (y/n): " DO_DEPLOY
if [[ "$DO_DEPLOY" =~ ^[Yy]$ ]]; then
    print_step "Installing server dependencies..."
    (cd server && npm install)
    print_ok "Dependencies installed"

    print_step "Deploying to production..."
    DEPLOY_URL=$(vercel --prod 2>&1 | tail -1)
    echo ""
    print_ok "Deployed successfully!"
    echo -e "  ${GREEN}URL:${NC} ${DEPLOY_URL}"
else
    print_warn "Skipping deploy. Run 'vercel --prod' when ready."
fi

# -----------------------------------------------------------
# Summary
# -----------------------------------------------------------
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Setup Complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "  Next steps:"
echo "    1. Visit your deployment URL to verify"
echo "    2. Connect your custom domain in Vercel dashboard"
echo "    3. Set up Stripe webhooks (if using billing):"
echo "       Endpoint: https://yourdomain.com/api/v1/webhooks/stripe"
echo "    4. For multiplayer WebSocket, deploy server/ separately"
echo "       to Railway, Fly.io, or Render"
echo ""
echo "  Useful commands:"
echo "    vercel              # Deploy to preview"
echo "    vercel --prod       # Deploy to production"
echo "    vercel env ls       # List environment variables"
echo "    vercel logs         # View deployment logs"
echo ""

# Clean up temp env file
rm -f .env.vercel
