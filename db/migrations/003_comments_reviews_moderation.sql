-- =============================================
-- STEM Adventures - Comments, Reviews & Moderation
-- =============================================
-- Adds user-generated content (comments, reviews/ratings)
-- and admin moderation tooling.
-- =============================================

-- =============================================
-- Admin Roles
-- =============================================
ALTER TABLE players ADD COLUMN IF NOT EXISTS admin_role VARCHAR(32) DEFAULT NULL;
-- admin_role values: NULL (regular), 'moderator', 'admin', 'super_admin'

CREATE INDEX IF NOT EXISTS idx_players_admin_role
    ON players(tenant_id, admin_role) WHERE admin_role IS NOT NULL;

-- =============================================
-- Game Reviews (1 per player per game)
-- =============================================
CREATE TABLE game_reviews (
    id              VARCHAR(64) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    player_id       VARCHAR(64) NOT NULL,
    tenant_id       VARCHAR(64) NOT NULL REFERENCES tenants(id),
    game_id         VARCHAR(64) NOT NULL,
    rating          SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    title           VARCHAR(200),
    body            TEXT,
    status          VARCHAR(32) DEFAULT 'published',
    -- status: published, pending, hidden, removed
    moderated_by    VARCHAR(64),
    moderated_at    TIMESTAMPTZ,
    moderation_note TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(player_id, tenant_id, game_id),
    FOREIGN KEY (player_id, tenant_id) REFERENCES players(id, tenant_id)
);

CREATE INDEX idx_reviews_game ON game_reviews(tenant_id, game_id, status, created_at DESC);
CREATE INDEX idx_reviews_player ON game_reviews(player_id, tenant_id);
CREATE INDEX idx_reviews_moderation ON game_reviews(tenant_id, status) WHERE status != 'published';

-- =============================================
-- Comments (on games, threaded)
-- =============================================
CREATE TABLE comments (
    id              VARCHAR(64) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    player_id       VARCHAR(64) NOT NULL,
    tenant_id       VARCHAR(64) NOT NULL REFERENCES tenants(id),
    game_id         VARCHAR(64) NOT NULL,
    parent_id       VARCHAR(64) REFERENCES comments(id) ON DELETE CASCADE,
    body            TEXT NOT NULL,
    status          VARCHAR(32) DEFAULT 'published',
    -- status: published, pending, hidden, removed
    report_count    INTEGER DEFAULT 0,
    moderated_by    VARCHAR(64),
    moderated_at    TIMESTAMPTZ,
    moderation_note TEXT,
    edited_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    FOREIGN KEY (player_id, tenant_id) REFERENCES players(id, tenant_id)
);

CREATE INDEX idx_comments_game ON comments(tenant_id, game_id, status, created_at DESC);
CREATE INDEX idx_comments_thread ON comments(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_comments_player ON comments(player_id, tenant_id);
CREATE INDEX idx_comments_moderation ON comments(tenant_id, status, report_count DESC)
    WHERE status != 'published' OR report_count > 0;

-- =============================================
-- Content Reports (flagging system)
-- =============================================
CREATE TABLE content_reports (
    id              VARCHAR(64) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    reporter_id     VARCHAR(64) NOT NULL,
    tenant_id       VARCHAR(64) NOT NULL REFERENCES tenants(id),
    content_type    VARCHAR(32) NOT NULL,         -- 'comment', 'review'
    content_id      VARCHAR(64) NOT NULL,
    reason          VARCHAR(64) NOT NULL,
    -- reason: spam, harassment, inappropriate, off_topic, other
    description     TEXT,
    status          VARCHAR(32) DEFAULT 'open',
    -- status: open, reviewed, resolved, dismissed
    resolved_by     VARCHAR(64),
    resolved_at     TIMESTAMPTZ,
    resolution_note TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(reporter_id, content_type, content_id)
);

CREATE INDEX idx_reports_status ON content_reports(tenant_id, status, created_at DESC);
CREATE INDEX idx_reports_content ON content_reports(content_type, content_id);

-- =============================================
-- Moderation Action Log (audit trail)
-- =============================================
CREATE TABLE moderation_log (
    id              VARCHAR(64) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    admin_id        VARCHAR(64) NOT NULL,
    tenant_id       VARCHAR(64) NOT NULL REFERENCES tenants(id),
    action          VARCHAR(64) NOT NULL,
    -- action: approve, hide, remove, restore, ban_user, warn_user, dismiss_report
    content_type    VARCHAR(32),                  -- 'comment', 'review', 'player'
    content_id      VARCHAR(64),
    target_player_id VARCHAR(64),
    reason          TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mod_log_admin ON moderation_log(admin_id, created_at DESC);
CREATE INDEX idx_mod_log_target ON moderation_log(target_player_id, created_at DESC);
CREATE INDEX idx_mod_log_content ON moderation_log(content_type, content_id);
