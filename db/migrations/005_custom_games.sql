-- Migration 005: Custom (admin-added) games
-- Stores game definitions that admins add via the UI.
-- These games load dynamically alongside the hardcoded 25.

CREATE TABLE IF NOT EXISTS custom_games (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL DEFAULT 'stem_default',
    title           TEXT NOT NULL,
    classic         TEXT,
    character_id    TEXT,
    mechanic        TEXT,
    icon_color      TEXT NOT NULL DEFAULT '#333',
    icon_emoji      TEXT NOT NULL DEFAULT '?',
    scene_code      TEXT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order      INT NOT NULL DEFAULT 100,
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_games_tenant ON custom_games(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_custom_games_sort ON custom_games(tenant_id, sort_order);
