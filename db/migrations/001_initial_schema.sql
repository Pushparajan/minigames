-- =============================================
-- STEM Adventures - Initial Database Schema
-- =============================================
-- Designed for SaaS multi-tenant deployment
-- supporting 1M+ concurrent players.
--
-- Partitioning strategy:
--   - score_history partitioned by month (RANGE on created_at)
--   - Indexes optimized for leaderboard queries
--   - tenant_id in all tables for data isolation
-- =============================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================
-- Tenants (SaaS multi-tenancy)
-- =============================================
CREATE TABLE tenants (
    id              VARCHAR(64) PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    api_key         VARCHAR(128) UNIQUE NOT NULL,
    plan            VARCHAR(32) DEFAULT 'free',          -- free, basic, pro, enterprise
    max_players     INTEGER DEFAULT 10000,
    settings_json   JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Default tenant
INSERT INTO tenants (id, name, api_key) VALUES
    ('stem_default', 'STEM School Adventures', 'tenant_stem_default_dev');

-- =============================================
-- Players
-- =============================================
CREATE TABLE players (
    id                  VARCHAR(64) NOT NULL,
    tenant_id           VARCHAR(64) NOT NULL REFERENCES tenants(id),
    email               VARCHAR(255),
    password_hash       VARCHAR(255),
    display_name        VARCHAR(100) NOT NULL DEFAULT 'Explorer',
    avatar_character    VARCHAR(32) DEFAULT 'guha',
    is_guest            BOOLEAN DEFAULT true,
    total_score         BIGINT DEFAULT 0,
    games_played        INTEGER DEFAULT 0,
    total_play_time     INTEGER DEFAULT 0,            -- seconds
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    last_login_at       TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (id, tenant_id)
);

-- Indexes for player lookups
CREATE UNIQUE INDEX idx_players_email_tenant
    ON players(email, tenant_id)
    WHERE email IS NOT NULL;

CREATE INDEX idx_players_total_score
    ON players(tenant_id, total_score DESC);

CREATE INDEX idx_players_last_login
    ON players(tenant_id, last_login_at DESC);

-- =============================================
-- Game Progress (per-player, per-game)
-- =============================================
CREATE TABLE game_progress (
    player_id       VARCHAR(64) NOT NULL,
    tenant_id       VARCHAR(64) NOT NULL,
    game_id         VARCHAR(64) NOT NULL,
    high_score      BIGINT DEFAULT 0,
    best_time       INTEGER,                          -- milliseconds
    level           INTEGER DEFAULT 1,
    stars           SMALLINT DEFAULT 0 CHECK (stars >= 0 AND stars <= 3),
    play_count      INTEGER DEFAULT 0,
    total_score     BIGINT DEFAULT 0,
    custom_data     JSONB DEFAULT '{}',
    last_played_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (player_id, tenant_id, game_id),
    FOREIGN KEY (player_id, tenant_id) REFERENCES players(id, tenant_id)
);

-- Leaderboard index: fast high_score lookups per game
CREATE INDEX idx_progress_leaderboard
    ON game_progress(tenant_id, game_id, high_score DESC);

-- Stars summary index
CREATE INDEX idx_progress_stars
    ON game_progress(tenant_id, game_id, stars DESC);

-- =============================================
-- Score History (append-only, partitioned by month)
-- =============================================
CREATE TABLE score_history (
    id              BIGSERIAL,
    player_id       VARCHAR(64) NOT NULL,
    tenant_id       VARCHAR(64) NOT NULL,
    game_id         VARCHAR(64) NOT NULL,
    score           BIGINT NOT NULL,
    level           INTEGER DEFAULT 1,
    play_time       INTEGER,                          -- milliseconds
    created_at      TIMESTAMPTZ DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Create monthly partitions for the current year
-- (In production, use pg_partman or a cron job to auto-create)
CREATE TABLE score_history_2026_01 PARTITION OF score_history
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE score_history_2026_02 PARTITION OF score_history
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE score_history_2026_03 PARTITION OF score_history
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE score_history_2026_04 PARTITION OF score_history
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE score_history_2026_05 PARTITION OF score_history
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE score_history_2026_06 PARTITION OF score_history
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE score_history_2026_07 PARTITION OF score_history
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE score_history_2026_08 PARTITION OF score_history
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE score_history_2026_09 PARTITION OF score_history
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE score_history_2026_10 PARTITION OF score_history
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE score_history_2026_11 PARTITION OF score_history
    FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE score_history_2026_12 PARTITION OF score_history
    FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- Index for time-filtered leaderboards
CREATE INDEX idx_score_history_leaderboard
    ON score_history(tenant_id, game_id, created_at DESC, score DESC);

-- Index for player history lookups
CREATE INDEX idx_score_history_player
    ON score_history(player_id, tenant_id, game_id, created_at DESC);

-- =============================================
-- Player Achievements
-- =============================================
CREATE TABLE player_achievements (
    player_id       VARCHAR(64) NOT NULL,
    tenant_id       VARCHAR(64) NOT NULL,
    achievement_id  VARCHAR(64) NOT NULL,
    game_id         VARCHAR(64),                      -- NULL for global achievements
    earned_at       TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (player_id, tenant_id, achievement_id),
    FOREIGN KEY (player_id, tenant_id) REFERENCES players(id, tenant_id)
);

-- =============================================
-- Player Settings (cloud-synced preferences)
-- =============================================
CREATE TABLE player_settings (
    player_id       VARCHAR(64) NOT NULL,
    tenant_id       VARCHAR(64) NOT NULL,
    settings_json   JSONB DEFAULT '{}',
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (player_id, tenant_id),
    FOREIGN KEY (player_id, tenant_id) REFERENCES players(id, tenant_id)
);

-- =============================================
-- Achievement Definitions
-- =============================================
CREATE TABLE achievements (
    id              VARCHAR(64) PRIMARY KEY,
    tenant_id       VARCHAR(64) NOT NULL REFERENCES tenants(id),
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    icon            VARCHAR(32),
    game_id         VARCHAR(64),                      -- NULL for global
    criteria_json   JSONB NOT NULL,                   -- { type: 'score', threshold: 1000, gameId: '...' }
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- Seed default achievements
-- =============================================
INSERT INTO achievements (id, tenant_id, name, description, icon, game_id, criteria_json) VALUES
    ('first_game', 'stem_default', 'First Steps', 'Play your first game', 'star', NULL,
     '{"type": "games_played", "threshold": 1}'),
    ('score_1000', 'stem_default', 'Score Explorer', 'Reach a total score of 1,000', 'trophy', NULL,
     '{"type": "total_score", "threshold": 1000}'),
    ('score_10000', 'stem_default', 'Score Master', 'Reach a total score of 10,000', 'trophy', NULL,
     '{"type": "total_score", "threshold": 10000}'),
    ('score_100000', 'stem_default', 'Score Legend', 'Reach a total score of 100,000', 'crown', NULL,
     '{"type": "total_score", "threshold": 100000}'),
    ('all_stars', 'stem_default', 'Completionist', 'Earn 3 stars on all 25 games', 'crown', NULL,
     '{"type": "all_three_stars", "threshold": 25}'),
    ('five_games', 'stem_default', 'Game Hopper', 'Try 5 different games', 'star', NULL,
     '{"type": "unique_games", "threshold": 5}'),
    ('all_games', 'stem_default', 'STEM Explorer', 'Play all 25 games', 'badge', NULL,
     '{"type": "unique_games", "threshold": 25}');
