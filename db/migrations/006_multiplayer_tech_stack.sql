-- Migration 006: Multiplayer Tech Stack - Core Systems
-- =====================================================
-- Friends, Leaderboards, Seasons, Battle Pass, Economy,
-- Anti-cheat, Skill Rating, Presence Tracking

-- =========================================
-- Player Skill Rating & Region
-- =========================================

ALTER TABLE players ADD COLUMN IF NOT EXISTS skill_rating INT NOT NULL DEFAULT 1000;
ALTER TABLE players ADD COLUMN IF NOT EXISTS skill_deviation INT NOT NULL DEFAULT 350;
ALTER TABLE players ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT 'us-east';
ALTER TABLE players ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en-US';
ALTER TABLE players ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE players ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE players ADD COLUMN IF NOT EXISTS ban_expires_at TIMESTAMPTZ;
ALTER TABLE players ADD COLUMN IF NOT EXISTS ban_reason TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS gdpr_consent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE players ADD COLUMN IF NOT EXISTS gdpr_consent_at TIMESTAMPTZ;
ALTER TABLE players ADD COLUMN IF NOT EXISTS data_deletion_requested_at TIMESTAMPTZ;
ALTER TABLE players ADD COLUMN IF NOT EXISTS sso_provider TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS sso_provider_id TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_players_skill ON players(tenant_id, skill_rating);
CREATE INDEX IF NOT EXISTS idx_players_region ON players(tenant_id, region);
CREATE INDEX IF NOT EXISTS idx_players_sso ON players(sso_provider, sso_provider_id) WHERE sso_provider IS NOT NULL;

-- =========================================
-- Friend System
-- =========================================

CREATE TABLE IF NOT EXISTS friendships (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       TEXT NOT NULL DEFAULT 'stem_default',
    player_id       UUID NOT NULL,
    friend_id       UUID NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending, accepted, blocked
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, player_id, friend_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_player ON friendships(tenant_id, player_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_friend ON friendships(tenant_id, friend_id, status);

-- =========================================
-- Player Presence
-- =========================================

CREATE TABLE IF NOT EXISTS player_presence (
    player_id       UUID PRIMARY KEY,
    tenant_id       TEXT NOT NULL DEFAULT 'stem_default',
    status          TEXT NOT NULL DEFAULT 'offline',  -- online, in_game, in_lobby, away, offline
    current_game_id TEXT,
    current_room_id TEXT,
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    connected_at    TIMESTAMPTZ,
    server_node     TEXT
);

CREATE INDEX IF NOT EXISTS idx_presence_tenant ON player_presence(tenant_id, status);

-- =========================================
-- Seasons
-- =========================================

CREATE TABLE IF NOT EXISTS seasons (
    id              SERIAL PRIMARY KEY,
    tenant_id       TEXT NOT NULL DEFAULT 'stem_default',
    name            TEXT NOT NULL,
    starts_at       TIMESTAMPTZ NOT NULL,
    ends_at         TIMESTAMPTZ NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT FALSE,
    config          JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seasons_active ON seasons(tenant_id, is_active);

-- =========================================
-- Leaderboards (Season-aware)
-- =========================================

CREATE TABLE IF NOT EXISTS leaderboard_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       TEXT NOT NULL DEFAULT 'stem_default',
    player_id       UUID NOT NULL,
    game_id         TEXT NOT NULL,
    season_id       INT REFERENCES seasons(id),
    region          TEXT NOT NULL DEFAULT 'global',
    score           BIGINT NOT NULL DEFAULT 0,
    rank            INT,
    wins            INT NOT NULL DEFAULT 0,
    losses          INT NOT NULL DEFAULT 0,
    draws           INT NOT NULL DEFAULT 0,
    matches_played  INT NOT NULL DEFAULT 0,
    skill_rating    INT NOT NULL DEFAULT 1000,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, player_id, game_id, season_id, region)
);

CREATE INDEX IF NOT EXISTS idx_lb_ranking ON leaderboard_entries(tenant_id, game_id, season_id, region, score DESC);
CREATE INDEX IF NOT EXISTS idx_lb_player ON leaderboard_entries(tenant_id, player_id);

-- =========================================
-- Battle Pass
-- =========================================

CREATE TABLE IF NOT EXISTS battle_passes (
    id              SERIAL PRIMARY KEY,
    tenant_id       TEXT NOT NULL DEFAULT 'stem_default',
    season_id       INT REFERENCES seasons(id),
    name            TEXT NOT NULL,
    max_tier        INT NOT NULL DEFAULT 50,
    xp_per_tier     INT NOT NULL DEFAULT 1000,
    is_active       BOOLEAN NOT NULL DEFAULT FALSE,
    free_rewards    JSONB NOT NULL DEFAULT '[]',   -- [{tier, reward_type, reward_data}]
    premium_rewards JSONB NOT NULL DEFAULT '[]',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS player_battle_pass (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       TEXT NOT NULL DEFAULT 'stem_default',
    player_id       UUID NOT NULL,
    battle_pass_id  INT REFERENCES battle_passes(id),
    current_tier    INT NOT NULL DEFAULT 0,
    current_xp      INT NOT NULL DEFAULT 0,
    is_premium      BOOLEAN NOT NULL DEFAULT FALSE,
    claimed_tiers   JSONB NOT NULL DEFAULT '[]',
    purchased_at    TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, player_id, battle_pass_id)
);

CREATE INDEX IF NOT EXISTS idx_pbp_player ON player_battle_pass(tenant_id, player_id);

-- =========================================
-- Virtual Economy (Wallets & Transactions)
-- =========================================

CREATE TABLE IF NOT EXISTS player_wallets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       TEXT NOT NULL DEFAULT 'stem_default',
    player_id       UUID NOT NULL,
    currency_type   TEXT NOT NULL DEFAULT 'coins',  -- coins, gems, tickets
    balance         BIGINT NOT NULL DEFAULT 0,
    lifetime_earned BIGINT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, player_id, currency_type),
    CONSTRAINT positive_balance CHECK (balance >= 0)
);

CREATE TABLE IF NOT EXISTS economy_transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       TEXT NOT NULL DEFAULT 'stem_default',
    player_id       UUID NOT NULL,
    currency_type   TEXT NOT NULL,
    amount          BIGINT NOT NULL,
    balance_after   BIGINT NOT NULL,
    tx_type         TEXT NOT NULL,   -- earn, spend, purchase, refund, admin_grant
    source          TEXT NOT NULL,   -- match_win, battle_pass, daily_reward, store, admin
    reference_id    TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_player ON player_wallets(tenant_id, player_id);
CREATE INDEX IF NOT EXISTS idx_tx_player ON economy_transactions(tenant_id, player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_reference ON economy_transactions(reference_id) WHERE reference_id IS NOT NULL;

-- =========================================
-- Store / Items
-- =========================================

CREATE TABLE IF NOT EXISTS store_items (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL DEFAULT 'stem_default',
    name            TEXT NOT NULL,
    description     TEXT,
    item_type       TEXT NOT NULL,       -- cosmetic, avatar, powerup, battle_pass
    currency_type   TEXT NOT NULL DEFAULT 'coins',
    price           BIGINT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS player_inventory (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       TEXT NOT NULL DEFAULT 'stem_default',
    player_id       UUID NOT NULL,
    item_id         TEXT NOT NULL REFERENCES store_items(id),
    quantity        INT NOT NULL DEFAULT 1,
    acquired_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source          TEXT NOT NULL DEFAULT 'store',
    UNIQUE(tenant_id, player_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_player ON player_inventory(tenant_id, player_id);

-- =========================================
-- Anti-Cheat: Audit Log & Flags
-- =========================================

CREATE TABLE IF NOT EXISTS anticheat_flags (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       TEXT NOT NULL DEFAULT 'stem_default',
    player_id       UUID NOT NULL,
    flag_type       TEXT NOT NULL,     -- impossible_stats, speed_hack, score_anomaly, win_rate_anomaly
    severity        TEXT NOT NULL DEFAULT 'warning',  -- info, warning, critical
    details         JSONB NOT NULL DEFAULT '{}',
    match_id        UUID,
    status          TEXT NOT NULL DEFAULT 'open',     -- open, reviewed, dismissed, actioned
    reviewed_by     UUID,
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ac_player ON anticheat_flags(tenant_id, player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ac_open ON anticheat_flags(tenant_id, status) WHERE status = 'open';

-- =========================================
-- Server-side Game Action Log (replay & validation)
-- =========================================

CREATE TABLE IF NOT EXISTS game_action_log (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       TEXT NOT NULL DEFAULT 'stem_default',
    match_id        UUID NOT NULL,
    player_id       UUID NOT NULL,
    tick            INT NOT NULL,
    action_type     TEXT NOT NULL,
    action_data     JSONB NOT NULL DEFAULT '{}',
    server_state    JSONB,
    validated       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_action_log_match ON game_action_log(match_id, tick);

-- =========================================
-- Performance Metrics
-- =========================================

CREATE TABLE IF NOT EXISTS server_metrics (
    id              BIGSERIAL PRIMARY KEY,
    node_id         TEXT NOT NULL,
    tenant_id       TEXT NOT NULL DEFAULT 'stem_default',
    ccu             INT NOT NULL DEFAULT 0,
    rooms_active    INT NOT NULL DEFAULT 0,
    avg_latency_ms  FLOAT,
    p95_latency_ms  FLOAT,
    memory_mb       FLOAT,
    cpu_percent     FLOAT,
    tick_rate       FLOAT,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metrics_time ON server_metrics(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_node ON server_metrics(node_id, recorded_at DESC);

-- =========================================
-- GDPR Data Export Requests
-- =========================================

CREATE TABLE IF NOT EXISTS gdpr_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       TEXT NOT NULL DEFAULT 'stem_default',
    player_id       UUID NOT NULL,
    request_type    TEXT NOT NULL,    -- export, delete, rectify
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending, processing, completed, failed
    download_url    TEXT,
    completed_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gdpr_player ON gdpr_requests(tenant_id, player_id);
