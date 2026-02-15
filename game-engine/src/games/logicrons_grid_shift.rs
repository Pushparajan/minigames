use bevy::prelude::*;
use crate::BevyBridge;
use crate::pixar::{self, PixarAssets, CharacterConfig, palette};
use crate::asset_loader::CustomAssets;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLS: i32 = 7;
const ROWS: i32 = 7;
const TILE: f32 = 60.0;
const ORIGIN_X: f32 = -((COLS as f32) * TILE) / 2.0 + TILE / 2.0;
const ORIGIN_Y: f32 = -((ROWS as f32) * TILE) / 2.0 + TILE / 2.0;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

#[derive(Component)]
pub struct GameEntity;

#[derive(Clone, Copy, PartialEq)]
enum BlockState { Standing, LyingH, LyingV }

#[derive(Component)]
struct Block { state: BlockState, gx: i32, gy: i32 }

#[derive(Clone, Copy, PartialEq)]
enum FloorKind { Solid, Void, Goal }

#[derive(Component)]
struct FloorTile { kind: FloorKind, gx: i32, gy: i32 }

#[derive(Component)]
struct BlockVisual(usize); // 0 or 1 for the two halves

#[derive(Component)]
struct ScoreText;

#[derive(Resource)]
struct GameState {
    score: i32,
    level: usize,
    moves: i32,
    cooldown: f32,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn wp(gx: i32, gy: i32, z: f32) -> Vec3 {
    Vec3::new(ORIGIN_X + gx as f32 * TILE, ORIGIN_Y + gy as f32 * TILE, z)
}

struct LevelData {
    floor: Vec<(i32, i32, FloorKind)>,
    start: (i32, i32, BlockState),
}

fn get_level(n: usize) -> LevelData {
    let mut floor = Vec::new();
    // Fill all as solid, then poke voids
    for y in 0..ROWS {
        for x in 0..COLS {
            floor.push((x, y, FloorKind::Solid));
        }
    }
    let voids: Vec<(i32, i32)>;
    let goal: (i32, i32);
    let start: (i32, i32, BlockState);

    match n {
        0 => {
            voids = vec![(0,0),(0,1),(6,0),(6,1),(0,5),(0,6),(6,5),(6,6)];
            goal = (5, 3);
            start = (1, 3, BlockState::Standing);
        }
        1 => {
            voids = vec![(0,0),(1,0),(0,1),(5,0),(6,0),(6,1),(0,5),(0,6),(1,6),(5,6),(6,5),(6,6),(3,3)];
            goal = (5, 5);
            start = (1, 1, BlockState::Standing);
        }
        _ => {
            voids = vec![(0,0),(1,0),(0,1),(6,0),(6,1),(5,0),(0,6),(1,6),(0,5),(6,6),(5,6),(6,5),(2,2),(4,4),(3,1),(1,3)];
            goal = (5, 3);
            start = (1, 5, BlockState::Standing);
        }
    }

    for &(vx, vy) in &voids {
        if let Some(t) = floor.iter_mut().find(|(x,y,_)| *x == vx && *y == vy) {
            t.2 = FloorKind::Void;
        }
    }
    if let Some(t) = floor.iter_mut().find(|(x,y,_)| *x == goal.0 && *y == goal.1) {
        t.2 = FloorKind::Goal;
    }

    LevelData { floor, start }
}

fn floor_color(kind: FloorKind) -> Color {
    match kind {
        FloorKind::Solid => palette::SHADOW,
        FloorKind::Void => palette::LAB_BG,
        FloorKind::Goal => palette::GOLD,
    }
}

fn spawn_level(commands: &mut Commands, pixar_assets: &PixarAssets, level: usize) {
    let data = get_level(level);

    for &(gx, gy, kind) in &data.floor {
        let color = floor_color(kind);
        let is_goal = kind == FloorKind::Goal;
        let config = CharacterConfig::prop(color, Vec2::splat(TILE - 2.0), is_goal);
        pixar::spawn_character(commands, pixar_assets, &config, wp(gx, gy, 0.0), (
            FloorTile { kind, gx, gy },
            GameEntity,
        ));
    }

    let (sx, sy, ss) = data.start;
    // Active block tile (brighter color)
    let config = CharacterConfig::prop(palette::HERO_BLUE, Vec2::splat(TILE - 6.0), true);
    pixar::spawn_character(commands, pixar_assets, &config, wp(sx, sy, 1.0), (
        Block { state: ss, gx: sx, gy: sy },
        BlockVisual(0),
        GameEntity,
    ));
    // Second visual half (only visible when lying)
    let config2 = CharacterConfig::prop(palette::HERO_BLUE, Vec2::splat(TILE - 6.0), true);
    pixar::spawn_character(commands, pixar_assets, &config2, wp(sx, sy, 1.0), (
        BlockVisual(1),
        GameEntity,
    ));
}

fn block_tiles(b: &Block) -> Vec<(i32, i32)> {
    match b.state {
        BlockState::Standing => vec![(b.gx, b.gy)],
        BlockState::LyingH => vec![(b.gx, b.gy), (b.gx + 1, b.gy)],
        BlockState::LyingV => vec![(b.gx, b.gy), (b.gx, b.gy + 1)],
    }
}

fn tile_is_safe(gx: i32, gy: i32, fq: &Query<&FloorTile>) -> bool {
    if gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS { return false; }
    fq.iter().any(|f| f.gx == gx && f.gy == gy && f.kind != FloorKind::Void)
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

pub fn setup(mut commands: Commands, pixar_assets: Res<PixarAssets>, custom_assets: Res<CustomAssets>) {
    commands.insert_resource(GameState { score: 0, level: 0, moves: 0, cooldown: 0.0 });

    // Background
    if let Some(ref bg_handle) = custom_assets.background {
        commands.spawn((
            Sprite { image: bg_handle.clone(), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
            Transform::from_xyz(0.0, 0.0, -1.0),
            GameEntity,
        ));
    } else {
        commands.spawn((
            Sprite { color: palette::LAB_BG, custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
            Transform::from_xyz(0.0, 0.0, -1.0),
            GameEntity,
        ));
    }

    spawn_level(&mut commands, &pixar_assets, 0);

    commands.spawn((
        Text::new("Level 1 | Moves: 0"),
        TextFont { font_size: 20.0, ..default() },
        TextColor(Color::srgb(0.9, 0.85, 0.3)),
        Node { position_type: PositionType::Absolute, top: Val::Px(8.0), left: Val::Px(8.0), ..default() },
        ScoreText,
        GameEntity,
    ));
}

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

pub fn player_input(
    input: Res<ButtonInput<KeyCode>>,
    time: Res<Time>,
    mut state: ResMut<GameState>,
    mut bq: Query<&mut Block>,
    fq: Query<&FloorTile>,
    mut commands: Commands,
    entities: Query<Entity, With<GameEntity>>,
    mut next_state: ResMut<NextState<crate::AppState>>,
    pixar_assets: Res<PixarAssets>,
) {
    state.cooldown -= time.delta_secs();
    if state.cooldown > 0.0 { return; }

    let (dx, dy) = if input.just_pressed(KeyCode::ArrowRight) { (1, 0) }
        else if input.just_pressed(KeyCode::ArrowLeft) { (-1, 0) }
        else if input.just_pressed(KeyCode::ArrowUp) { (0, 1) }
        else if input.just_pressed(KeyCode::ArrowDown) { (0, -1) }
        else { return; };

    let Ok(mut block) = bq.get_single_mut() else { return };

    let (new_state, new_gx, new_gy) = match (block.state, dx, dy) {
        (BlockState::Standing, 1, 0) => (BlockState::LyingH, block.gx + 1, block.gy),
        (BlockState::Standing, -1, 0) => (BlockState::LyingH, block.gx - 2, block.gy),
        (BlockState::Standing, 0, 1) => (BlockState::LyingV, block.gx, block.gy + 1),
        (BlockState::Standing, 0, -1) => (BlockState::LyingV, block.gx, block.gy - 2),
        (BlockState::LyingH, 1, 0) => (BlockState::Standing, block.gx + 2, block.gy),
        (BlockState::LyingH, -1, 0) => (BlockState::Standing, block.gx - 1, block.gy),
        (BlockState::LyingH, 0, 1) => (BlockState::LyingH, block.gx, block.gy + 1),
        (BlockState::LyingH, 0, -1) => (BlockState::LyingH, block.gx, block.gy - 1),
        (BlockState::LyingV, 1, 0) => (BlockState::LyingV, block.gx + 1, block.gy),
        (BlockState::LyingV, -1, 0) => (BlockState::LyingV, block.gx - 1, block.gy),
        (BlockState::LyingV, 0, 1) => (BlockState::Standing, block.gx, block.gy + 2),
        (BlockState::LyingV, 0, -1) => (BlockState::Standing, block.gx, block.gy - 1),
        _ => return,
    };

    block.state = new_state;
    block.gx = new_gx;
    block.gy = new_gy;
    state.moves += 1;
    state.cooldown = 0.15;

    // Check all tiles under block are safe
    let tiles = block_tiles(&block);
    let fell = tiles.iter().any(|&(tx, ty)| !tile_is_safe(tx, ty, &fq));

    if fell {
        // Reset level
        state.moves = 0;
        for e in &entities { commands.entity(e).despawn(); }
        commands.spawn((
            Sprite { color: palette::LAB_BG, custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
            Transform::from_xyz(0.0, 0.0, -1.0),
            GameEntity,
        ));
        spawn_level(&mut commands, &pixar_assets, state.level);
        commands.spawn((
            Text::new(""),
            TextFont { font_size: 20.0, ..default() },
            TextColor(Color::srgb(0.9, 0.85, 0.3)),
            Node { position_type: PositionType::Absolute, top: Val::Px(8.0), left: Val::Px(8.0), ..default() },
            ScoreText, GameEntity,
        ));
        return;
    }

    // Check win: standing on goal
    if block.state == BlockState::Standing {
        let on_goal = fq.iter().any(|f| f.gx == block.gx && f.gy == block.gy && f.kind == FloorKind::Goal);
        if on_goal {
            state.score += 500;
            state.level += 1;
            state.moves = 0;
            if state.level >= 3 {
                next_state.set(crate::AppState::GameOver);
                return;
            }
            for e in &entities { commands.entity(e).despawn(); }
            commands.spawn((
                Sprite { color: palette::LAB_BG, custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
                Transform::from_xyz(0.0, 0.0, -1.0),
                GameEntity,
            ));
            spawn_level(&mut commands, &pixar_assets, state.level);
            commands.spawn((
                Text::new(""),
                TextFont { font_size: 20.0, ..default() },
                TextColor(Color::srgb(0.9, 0.85, 0.3)),
                Node { position_type: PositionType::Absolute, top: Val::Px(8.0), left: Val::Px(8.0), ..default() },
                ScoreText, GameEntity,
            ));
        }
    }
}

pub fn update_visuals(
    bq: Query<&Block>,
    mut vq: Query<(&BlockVisual, &mut Transform, &mut Visibility)>,
) {
    let Ok(block) = bq.get_single() else { return };
    let tiles = block_tiles(block);
    for (vis, mut tf, mut visibility) in &mut vq {
        if vis.0 < tiles.len() {
            *visibility = Visibility::Visible;
            let (tx, ty) = tiles[vis.0];
            tf.translation = wp(tx, ty, 1.0);
        } else {
            *visibility = Visibility::Hidden;
        }
    }
}

pub fn update_score(state: Res<GameState>, mut bridge: ResMut<BevyBridge>) {
    bridge.current_score = state.score;
}

pub fn update_hud(state: Res<GameState>, mut q: Query<&mut Text, With<ScoreText>>) {
    for mut t in &mut q {
        **t = format!("Level {} | Moves: {} | Score: {}", state.level + 1, state.moves, state.score);
    }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

pub fn cleanup(mut commands: Commands, q: Query<Entity, With<GameEntity>>) {
    for e in &q { commands.entity(e).despawn(); }
    commands.remove_resource::<GameState>();
}
