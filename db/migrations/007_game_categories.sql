-- Migration 007: Game Categories
-- ================================
-- Adds category support for organizing and grouping games.
-- Categories can be assigned to both built-in and custom games.

-- Categories table
CREATE TABLE IF NOT EXISTS game_categories (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL DEFAULT 'stem_default',
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL,
    description TEXT,
    icon_emoji  TEXT DEFAULT '📁',
    icon_color  TEXT DEFAULT '#667eea',
    sort_order  INT DEFAULT 100,
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_categories_tenant
    ON game_categories(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_game_categories_sort
    ON game_categories(tenant_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_categories_slug
    ON game_categories(tenant_id, slug);

-- Junction table: maps any game (built-in or custom) to categories
CREATE TABLE IF NOT EXISTS game_category_assignments (
    id          SERIAL PRIMARY KEY,
    tenant_id   TEXT NOT NULL DEFAULT 'stem_default',
    game_id     TEXT NOT NULL,
    category_id TEXT NOT NULL REFERENCES game_categories(id) ON DELETE CASCADE,
    sort_order  INT DEFAULT 100,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, game_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_gca_tenant_category
    ON game_category_assignments(tenant_id, category_id);
CREATE INDEX IF NOT EXISTS idx_gca_tenant_game
    ON game_category_assignments(tenant_id, game_id);

-- Add category_id column to custom_games for quick single-category reference
ALTER TABLE custom_games ADD COLUMN IF NOT EXISTS category_id TEXT REFERENCES game_categories(id) ON DELETE SET NULL;

-- Seed default categories
INSERT INTO game_categories (id, tenant_id, name, slug, description, icon_emoji, icon_color, sort_order)
VALUES
    ('physics',    'stem_default', 'Physics',      'physics',      'Games featuring physics simulations and mechanics',    '⚛️', '#e74c3c', 10),
    ('puzzle',     'stem_default', 'Puzzles',       'puzzles',      'Brain-teasing puzzle and logic games',                '🧩', '#9b59b6', 20),
    ('adventure',  'stem_default', 'Adventure',     'adventure',    'Exploration and story-driven games',                  '🗺️', '#2ecc71', 30),
    ('racing',     'stem_default', 'Racing',        'racing',       'Speed and racing challenge games',                    '🏎️', '#f39c12', 40),
    ('action',     'stem_default', 'Action',        'action',       'Fast-paced action and defense games',                 '⚡', '#e67e22', 50),
    ('engineering','stem_default', 'Engineering',   'engineering',  'Building, crafting, and engineering challenges',       '🔧', '#3498db', 60),
    ('chemistry',  'stem_default', 'Chemistry',     'chemistry',    'Chemical reactions and molecular science games',       '🧪', '#1abc9c', 70),
    ('strategy',   'stem_default', 'Strategy',      'strategy',     'Planning and strategic thinking games',               '🎯', '#8e44ad', 80)
ON CONFLICT DO NOTHING;

-- Seed default category assignments for the 25 built-in games
INSERT INTO game_category_assignments (tenant_id, game_id, category_id) VALUES
    -- Physics games
    ('stem_default', 'PhysicsMasterBilliards', 'physics'),
    ('stem_default', 'STEMProjectVolley',      'physics'),
    ('stem_default', 'GravityShiftRun',        'physics'),
    ('stem_default', 'HeavyGearDelivery',      'physics'),
    -- Puzzle games
    ('stem_default', 'LogicronsGridShift',     'puzzle'),
    ('stem_default', 'HydroLogicPuzzles',      'puzzle'),
    ('stem_default', 'ColorLabQuest',          'puzzle'),
    ('stem_default', 'CableCarConundrum',      'puzzle'),
    -- Adventure games
    ('stem_default', 'LabBreach',              'adventure'),
    ('stem_default', 'FindThePrincipal',       'adventure'),
    ('stem_default', 'HistoryVaultEscape',     'adventure'),
    ('stem_default', 'ChemistryEscape',        'adventure'),
    ('stem_default', 'GeologyDeepDive',        'adventure'),
    -- Racing games
    ('stem_default', 'CampusDash',             'racing'),
    ('stem_default', 'FormulaSTEM',            'racing'),
    ('stem_default', 'ParkourLab',             'racing'),
    -- Action games
    ('stem_default', 'SafetyFirstDefense',     'action'),
    ('stem_default', 'DroneDefense',           'action'),
    ('stem_default', 'CampusGuard',            'action'),
    ('stem_default', 'MolecularSplit',         'action'),
    -- Engineering games
    ('stem_default', 'RobotRepairBay',         'engineering'),
    ('stem_default', 'AeroEngineering',        'engineering'),
    ('stem_default', 'RoverFieldTest',         'engineering'),
    -- Chemistry games
    ('stem_default', 'DemoDay',                'chemistry'),
    -- Strategy games
    ('stem_default', 'STEMCelebration',        'strategy')
ON CONFLICT DO NOTHING;
