-- Migration 004: Multiplayer game sessions
-- Tracks multiplayer match history and results for leaderboard integration.

CREATE TABLE IF NOT EXISTS multiplayer_matches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       TEXT NOT NULL DEFAULT 'stem_default',
    game_id         TEXT NOT NULL,
    room_name       TEXT,
    player_count    INT NOT NULL DEFAULT 2,
    state           TEXT NOT NULL DEFAULT 'completed' CHECK (state IN ('completed', 'abandoned')),
    duration_ms     INT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS multiplayer_match_players (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id        UUID NOT NULL REFERENCES multiplayer_matches(id) ON DELETE CASCADE,
    player_id       UUID NOT NULL,
    tenant_id       TEXT NOT NULL DEFAULT 'stem_default',
    player_index    INT NOT NULL,
    score           INT NOT NULL DEFAULT 0,
    is_winner       BOOLEAN NOT NULL DEFAULT FALSE,
    placement       INT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mp_matches_tenant_game ON multiplayer_matches(tenant_id, game_id);
CREATE INDEX IF NOT EXISTS idx_mp_matches_started ON multiplayer_matches(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_match_players_player ON multiplayer_match_players(player_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_mp_match_players_match ON multiplayer_match_players(match_id);

-- Player multiplayer stats (win/loss record)
ALTER TABLE players ADD COLUMN IF NOT EXISTS mp_wins       INT NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS mp_losses     INT NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS mp_draws      INT NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS mp_matches    INT NOT NULL DEFAULT 0;
