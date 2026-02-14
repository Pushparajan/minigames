-- =============================================
-- STEM Adventures - Subscription & Billing Schema
-- =============================================
-- Adds Stripe subscription management, entitlements,
-- organisations (workspaces), storage quotas, and
-- usage metering for SaaS billing.
-- =============================================

-- =============================================
-- Organisations (workspaces / team accounts)
-- =============================================
CREATE TABLE organisations (
    id              VARCHAR(64) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    tenant_id       VARCHAR(64) NOT NULL REFERENCES tenants(id),
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(128) NOT NULL,
    owner_id        VARCHAR(64) NOT NULL,             -- player who created it
    stripe_customer_id   VARCHAR(255) UNIQUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(tenant_id, slug)
);

CREATE INDEX idx_org_owner ON organisations(owner_id, tenant_id);
CREATE INDEX idx_org_stripe ON organisations(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- =============================================
-- Organisation Members
-- =============================================
CREATE TABLE organisation_members (
    organisation_id VARCHAR(64) NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    player_id       VARCHAR(64) NOT NULL,
    tenant_id       VARCHAR(64) NOT NULL,
    role            VARCHAR(32) DEFAULT 'member',      -- owner, admin, member
    joined_at       TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (organisation_id, player_id),
    FOREIGN KEY (player_id, tenant_id) REFERENCES players(id, tenant_id)
);

-- =============================================
-- Subscriptions (Stripe-synced)
-- =============================================
CREATE TABLE subscriptions (
    id                      VARCHAR(64) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    organisation_id         VARCHAR(64) NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    tenant_id               VARCHAR(64) NOT NULL REFERENCES tenants(id),
    stripe_subscription_id  VARCHAR(255) UNIQUE,
    stripe_customer_id      VARCHAR(255),
    stripe_price_id         VARCHAR(255),
    status                  VARCHAR(32) NOT NULL DEFAULT 'incomplete',
    -- status values: incomplete, incomplete_expired, trialing, active,
    --   past_due, canceled, unpaid, paused
    plan_tier               VARCHAR(32) NOT NULL DEFAULT 'free',
    -- plan_tier: free, starter, pro, enterprise
    trial_start             TIMESTAMPTZ,
    trial_end               TIMESTAMPTZ,
    current_period_start    TIMESTAMPTZ,
    current_period_end      TIMESTAMPTZ,
    cancel_at               TIMESTAMPTZ,
    canceled_at             TIMESTAMPTZ,
    ended_at                TIMESTAMPTZ,
    metadata                JSONB DEFAULT '{}',
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sub_org ON subscriptions(organisation_id);
CREATE INDEX idx_sub_status ON subscriptions(tenant_id, status);
CREATE INDEX idx_sub_stripe ON subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- =============================================
-- Entitlements (feature access per subscription)
-- =============================================
CREATE TABLE entitlements (
    id                  VARCHAR(64) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    organisation_id     VARCHAR(64) NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    subscription_id     VARCHAR(64) REFERENCES subscriptions(id) ON DELETE SET NULL,
    tenant_id           VARCHAR(64) NOT NULL REFERENCES tenants(id),
    feature_key         VARCHAR(128) NOT NULL,
    -- feature keys: 'organisations', 'multiplayer', 'analytics_dashboard',
    --   'custom_branding', 'api_access', 'priority_support',
    --   'advanced_leaderboards', 'export_data', 'unlimited_games'
    is_enabled          BOOLEAN DEFAULT true,
    limit_value         INTEGER,                        -- NULL = unlimited
    usage_count         INTEGER DEFAULT 0,
    valid_from          TIMESTAMPTZ DEFAULT NOW(),
    valid_until         TIMESTAMPTZ,                    -- NULL = no expiry
    created_at          TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(organisation_id, feature_key)
);

CREATE INDEX idx_entitlement_org ON entitlements(organisation_id, is_enabled);
CREATE INDEX idx_entitlement_feature ON entitlements(tenant_id, feature_key);

-- =============================================
-- Plan Definitions (feature matrix)
-- =============================================
CREATE TABLE plan_definitions (
    id              VARCHAR(64) PRIMARY KEY,
    tenant_id       VARCHAR(64) NOT NULL REFERENCES tenants(id),
    plan_tier       VARCHAR(32) NOT NULL,               -- free, starter, pro, enterprise
    name            VARCHAR(128) NOT NULL,
    stripe_price_id VARCHAR(255),
    price_cents     INTEGER DEFAULT 0,
    billing_period  VARCHAR(16) DEFAULT 'monthly',      -- monthly, yearly
    max_members     INTEGER DEFAULT 1,
    max_storage_mb  INTEGER DEFAULT 100,
    max_games       INTEGER DEFAULT 5,
    features_json   JSONB NOT NULL DEFAULT '{}',
    -- { "organisations": true, "multiplayer": true, ... }
    is_active       BOOLEAN DEFAULT true,
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Seed plan definitions
INSERT INTO plan_definitions (id, tenant_id, plan_tier, name, price_cents, max_members, max_storage_mb, max_games, features_json, sort_order) VALUES
    ('plan_free', 'stem_default', 'free', 'Free Explorer', 0, 1, 100, 5,
     '{"organisations": false, "multiplayer": false, "analytics_dashboard": false, "custom_branding": false, "api_access": false, "priority_support": false, "advanced_leaderboards": false, "export_data": false, "unlimited_games": false}', 0),
    ('plan_starter', 'stem_default', 'starter', 'Starter School', 1999, 10, 1024, 15,
     '{"organisations": true, "multiplayer": true, "analytics_dashboard": false, "custom_branding": false, "api_access": false, "priority_support": false, "advanced_leaderboards": true, "export_data": false, "unlimited_games": false}', 1),
    ('plan_pro', 'stem_default', 'pro', 'Pro Academy', 4999, 50, 10240, 25,
     '{"organisations": true, "multiplayer": true, "analytics_dashboard": true, "custom_branding": true, "api_access": true, "priority_support": false, "advanced_leaderboards": true, "export_data": true, "unlimited_games": true}', 2),
    ('plan_enterprise', 'stem_default', 'enterprise', 'Enterprise District', 14999, -1, -1, 25,
     '{"organisations": true, "multiplayer": true, "analytics_dashboard": true, "custom_branding": true, "api_access": true, "priority_support": true, "advanced_leaderboards": true, "export_data": true, "unlimited_games": true}', 3);

-- =============================================
-- Storage Usage Tracking
-- =============================================
CREATE TABLE storage_usage (
    id                  VARCHAR(64) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    organisation_id     VARCHAR(64) NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    tenant_id           VARCHAR(64) NOT NULL REFERENCES tenants(id),
    resource_type       VARCHAR(64) NOT NULL,           -- 'avatar', 'replay', 'export', 'attachment'
    resource_id         VARCHAR(128) NOT NULL,
    size_bytes          BIGINT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(organisation_id, resource_type, resource_id)
);

CREATE INDEX idx_storage_org ON storage_usage(organisation_id);

-- =============================================
-- Usage Meters (API calls, game sessions, etc.)
-- =============================================
CREATE TABLE usage_meters (
    id                  VARCHAR(64) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    organisation_id     VARCHAR(64) NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    tenant_id           VARCHAR(64) NOT NULL REFERENCES tenants(id),
    meter_key           VARCHAR(64) NOT NULL,           -- 'api_calls', 'game_sessions', 'data_exports'
    period_start        TIMESTAMPTZ NOT NULL,
    period_end          TIMESTAMPTZ NOT NULL,
    count               BIGINT DEFAULT 0,
    limit_value         BIGINT,                         -- NULL = unlimited
    created_at          TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(organisation_id, meter_key, period_start)
);

CREATE INDEX idx_usage_meter_org ON usage_meters(organisation_id, meter_key, period_start DESC);

-- =============================================
-- Stripe Webhook Event Log (idempotency)
-- =============================================
CREATE TABLE stripe_events (
    id                  VARCHAR(128) PRIMARY KEY,       -- Stripe event ID
    tenant_id           VARCHAR(64) NOT NULL REFERENCES tenants(id),
    event_type          VARCHAR(128) NOT NULL,
    payload             JSONB NOT NULL,
    processed_at        TIMESTAMPTZ DEFAULT NOW(),
    status              VARCHAR(32) DEFAULT 'processed' -- processed, failed, skipped
);

CREATE INDEX idx_stripe_events_type ON stripe_events(event_type, processed_at DESC);

-- =============================================
-- Trial Tracking (one trial per user)
-- =============================================
CREATE TABLE trial_history (
    player_id           VARCHAR(64) NOT NULL,
    tenant_id           VARCHAR(64) NOT NULL,
    organisation_id     VARCHAR(64) NOT NULL REFERENCES organisations(id),
    trial_started_at    TIMESTAMPTZ DEFAULT NOW(),
    trial_ended_at      TIMESTAMPTZ,
    converted           BOOLEAN DEFAULT false,

    PRIMARY KEY (player_id, tenant_id),
    FOREIGN KEY (player_id, tenant_id) REFERENCES players(id, tenant_id)
);
