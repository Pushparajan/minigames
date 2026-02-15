use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLS: i32 = 8;
const ROWS: i32 = 8;
const TILE: f32 = 56.0;
const ORIGIN_X: f32 = -((COLS as f32) * TILE) / 2.0 + TILE / 2.0;
const ORIGIN_Y: f32 = -((ROWS as f32) * TILE) / 2.0 + TILE / 2.0;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

#[derive(Component)]
pub struct GameEntity;

#[derive(Component)]
struct Player { gx: i32, gy: i32 }

#[derive(Component)]
struct Orb { gx: i32, gy: i32 }

#[derive(Component)]
struct Target { gx: i32, gy: i32 }

#[derive(Component)]
struct Wall { gx: i32, gy: i32 }

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
    walls: Vec<(i32, i32)>,
    orbs: Vec<(i32, i32)>,
    targets: Vec<(i32, i32)>,
    player: (i32, i32),
}

fn get_level(n: usize) -> LevelData {
    let mut walls = Vec::new();
    // Border walls
    for x in 0..COLS {
        walls.push((x, 0));
        walls.push((x, ROWS - 1));
    }
    for y in 1..ROWS - 1 {
        walls.push((0, y));
        walls.push((COLS - 1, y));
    }
    match n {
        0 => {
            walls.extend([(3, 1), (3, 2), (4, 1)]);
            LevelData { walls, orbs: vec![(2, 4), (5, 5)], targets: vec![(2, 1), (5, 1)], player: (1, 3) }
        }
        1 => {
            walls.extend([(2, 1), (5, 1), (2, 3), (5, 3)]);
            LevelData { walls, orbs: vec![(3, 5), (4, 5), (3, 4)], targets: vec![(3, 1), (4, 1), (3, 2)], player: (1, 6) }
        }
        _ => {
            walls.extend([(2, 1), (5, 1), (2, 4), (5, 4)]);
            LevelData {
                walls,
                orbs: vec![(2, 6), (4, 6), (3, 5), (5, 5)],
                targets: vec![(3, 1), (4, 1), (3, 2), (4, 2)],
                player: (1, 6),
            }
        }
    }
}

fn spawn_level(commands: &mut Commands, level: usize) {
    let data = get_level(level);

    // Floor background
    for y in 0..ROWS {
        for x in 0..COLS {
            commands.spawn((
                Sprite { color: Color::srgb(0.1, 0.12, 0.18), custom_size: Some(Vec2::splat(TILE - 2.0)), ..default() },
                Transform::from_translation(wp(x, y, 0.0)),
                GameEntity,
            ));
        }
    }

    // Targets
    for &(gx, gy) in &data.targets {
        commands.spawn((
            Sprite { color: Color::srgb(0.2, 0.5, 0.2), custom_size: Some(Vec2::splat(TILE - 6.0)), ..default() },
            Transform::from_translation(wp(gx, gy, 0.1)),
            Target { gx, gy },
            GameEntity,
        ));
    }

    // Walls
    for &(gx, gy) in &data.walls {
        commands.spawn((
            Sprite { color: Color::srgb(0.3, 0.35, 0.45), custom_size: Some(Vec2::splat(TILE - 2.0)), ..default() },
            Transform::from_translation(wp(gx, gy, 0.2)),
            Wall { gx, gy },
            GameEntity,
        ));
    }

    // Orbs
    for &(gx, gy) in &data.orbs {
        commands.spawn((
            Sprite { color: Color::srgb(0.2, 0.6, 1.0), custom_size: Some(Vec2::splat(TILE - 12.0)), ..default() },
            Transform::from_translation(wp(gx, gy, 0.5)),
            Orb { gx, gy },
            GameEntity,
        ));
    }

    // Player
    let (px, py) = data.player;
    commands.spawn((
        Sprite { color: Color::srgb(1.0, 0.8, 0.2), custom_size: Some(Vec2::splat(TILE - 14.0)), ..default() },
        Transform::from_translation(wp(px, py, 1.0)),
        Player { gx: px, gy: py },
        GameEntity,
    ));
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

pub fn setup(mut commands: Commands) {
    commands.insert_resource(GameState { score: 0, level: 0, moves: 0, cooldown: 0.0 });

    // Background
    commands.spawn((
        Sprite { color: Color::srgb(0.04, 0.04, 0.08), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
        Transform::from_xyz(0.0, 0.0, -1.0),
        GameEntity,
    ));

    spawn_level(&mut commands, 0);

    // HUD
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
    mut pq: Query<&mut Player>,
    mut oq: Query<&mut Orb>,
    wq: Query<&Wall>,
) {
    state.cooldown -= time.delta_secs();
    if state.cooldown > 0.0 { return; }

    let (dx, dy) = if input.just_pressed(KeyCode::ArrowUp) { (0, 1) }
        else if input.just_pressed(KeyCode::ArrowDown) { (0, -1) }
        else if input.just_pressed(KeyCode::ArrowLeft) { (-1, 0) }
        else if input.just_pressed(KeyCode::ArrowRight) { (1, 0) }
        else { return; };

    let Ok(mut player) = pq.get_single_mut() else { return };
    let nx = player.gx + dx;
    let ny = player.gy + dy;

    // Check wall
    if wq.iter().any(|w| w.gx == nx && w.gy == ny) { return; }

    // Check orb push
    let pushing_orb = oq.iter().any(|o| o.gx == nx && o.gy == ny);
    if pushing_orb {
        let bx = nx + dx;
        let by = ny + dy;
        // Block behind must be empty
        if wq.iter().any(|w| w.gx == bx && w.gy == by) { return; }
        if oq.iter().any(|o| o.gx == bx && o.gy == by) { return; }
        // Push orb
        for mut orb in &mut oq {
            if orb.gx == nx && orb.gy == ny {
                orb.gx = bx;
                orb.gy = by;
                break;
            }
        }
    }

    player.gx = nx;
    player.gy = ny;
    state.moves += 1;
    state.cooldown = 0.15;
}

pub fn apply_gravity(
    mut oq: Query<&mut Orb>,
    wq: Query<&Wall>,
) {
    // Repeatedly drop orbs until stable
    for _ in 0..ROWS {
        let positions: Vec<(i32, i32)> = oq.iter().map(|o| (o.gx, o.gy)).collect();
        let mut moved = false;
        for mut orb in &mut oq {
            let below = orb.gy - 1;
            let blocked_wall = wq.iter().any(|w| w.gx == orb.gx && w.gy == below);
            let blocked_orb = positions.iter().any(|&(ox, oy)| ox == orb.gx && oy == below && !(ox == orb.gx && oy == orb.gy));
            if !blocked_wall && !blocked_orb && below >= 0 {
                orb.gy = below;
                moved = true;
            }
        }
        if !moved { break; }
    }
}

pub fn check_win(
    mut state: ResMut<GameState>,
    oq: Query<&Orb>,
    tq: Query<&Target>,
    mut commands: Commands,
    entities: Query<Entity, With<GameEntity>>,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    let all_on_target = tq.iter().all(|target| {
        oq.iter().any(|orb| orb.gx == target.gx && orb.gy == target.gy)
    });
    if !all_on_target { return; }

    state.score += 500;
    state.level += 1;
    state.moves = 0;

    if state.level >= 3 {
        next_state.set(crate::AppState::GameOver);
        return;
    }

    // Despawn everything except HUD background
    for e in &entities { commands.entity(e).despawn(); }

    // Background
    commands.spawn((
        Sprite { color: Color::srgb(0.04, 0.04, 0.08), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
        Transform::from_xyz(0.0, 0.0, -1.0),
        GameEntity,
    ));

    spawn_level(&mut commands, state.level);

    // Re-spawn HUD
    commands.spawn((
        Text::new(""),
        TextFont { font_size: 20.0, ..default() },
        TextColor(Color::srgb(0.9, 0.85, 0.3)),
        Node { position_type: PositionType::Absolute, top: Val::Px(8.0), left: Val::Px(8.0), ..default() },
        ScoreText,
        GameEntity,
    ));
}

pub fn update_visuals(
    pq: Query<&Player>,
    mut ptf: Query<&mut Transform, With<Player>>,
    oq: Query<&Orb>,
    mut otf: Query<(&Orb, &mut Transform), Without<Player>>,
) {
    if let Ok(p) = pq.get_single() {
        if let Ok(mut tf) = ptf.get_single_mut() {
            let pos = wp(p.gx, p.gy, 1.0);
            tf.translation = pos;
        }
    }
    for (orb, mut tf) in &mut otf {
        tf.translation = wp(orb.gx, orb.gy, 0.5);
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
