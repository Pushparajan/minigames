use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;

// Constants
const CELL: f32 = 70.0;
const COLS: i32 = 8;
const ROWS: i32 = 6;
const GRID_X: f32 = -(COLS as f32 * CELL) / 2.0;
const GRID_Y: f32 = (ROWS as f32 * CELL) / 2.0;
const TURRET_COST: i32 = 20;
const TURRET_RANGE: f32 = 150.0;
const TURRET_COOLDOWN: f32 = 0.8;
const BULLET_SPEED: f32 = 400.0;
const ENEMY_SPEED: f32 = 80.0;
const WAVE_INTERVAL: f32 = 15.0;
const START_GOLD: i32 = 100;
const START_LIVES: i32 = 10;

// S-shaped path waypoints (grid col, row)
const PATH: [(i32, i32); 12] = [
    (0, 0), (7, 0), (7, 1), (0, 1), (0, 2), (7, 2),
    (7, 3), (0, 3), (0, 4), (7, 4), (7, 5), (0, 5),
];

// Components
#[derive(Component)]
pub struct GameEntity;

#[derive(Component)]
struct Turret { cooldown: f32 }

#[derive(Component)]
struct Enemy { hp: i32, path_idx: usize, progress: f32 }

#[derive(Component)]
struct Bullet { dx: f32, dy: f32 }

#[derive(Component)]
struct PathMarker;

#[derive(Component)]
struct ScoreText;

#[derive(Component)]
struct InfoText;

#[derive(Resource)]
struct GameState {
    score: i32, gold: i32, lives: i32, wave: i32,
    wave_timer: f32, enemies_per_wave: i32, spawned: i32, spawn_cd: f32,
}

// Helpers
fn grid_to_world(col: i32, row: i32) -> Vec2 {
    Vec2::new(GRID_X + col as f32 * CELL + CELL / 2.0, GRID_Y - row as f32 * CELL - CELL / 2.0)
}

fn path_world(idx: usize) -> Vec2 { let (c, r) = PATH[idx]; grid_to_world(c, r) }

// Setup
pub fn setup(mut commands: Commands) {
    commands.insert_resource(GameState {
        score: 0, gold: START_GOLD, lives: START_LIVES,
        wave: 1, wave_timer: 5.0, enemies_per_wave: 3, spawned: 0, spawn_cd: 0.0,
    });

    commands.spawn((
        Sprite { color: Color::srgb(0.1, 0.12, 0.1), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
        Transform::from_xyz(0.0, 0.0, -1.0), GameEntity,
    ));

    for &(c, r) in &PATH {
        let pos = grid_to_world(c, r);
        commands.spawn((
            Sprite { color: Color::srgb(0.25, 0.22, 0.15), custom_size: Some(Vec2::splat(CELL - 2.0)), ..default() },
            Transform::from_xyz(pos.x, pos.y, -0.5), PathMarker, GameEntity,
        ));
    }

    commands.spawn((
        Text::new("Score: 0"),
        TextFont { font_size: 20.0, ..default() },
        TextColor(Color::srgb(0.9, 0.85, 0.3)),
        Node { position_type: PositionType::Absolute, top: Val::Px(8.0), left: Val::Px(8.0), ..default() },
        ScoreText, GameEntity,
    ));
    commands.spawn((
        Text::new("Gold: 100 | Lives: 10 | Wave: 1"),
        TextFont { font_size: 18.0, ..default() },
        TextColor(Color::srgb(0.7, 0.9, 0.7)),
        Node { position_type: PositionType::Absolute, top: Val::Px(8.0), right: Val::Px(8.0), ..default() },
        InfoText, GameEntity,
    ));
}

// Systems
pub fn player_input(
    mouse: Res<ButtonInput<MouseButton>>,
    touches: Res<Touches>,
    windows: Query<&Window>,
    camera_q: Query<(&Camera, &GlobalTransform)>,
    turrets: Query<&Transform, With<Turret>>,
    enemies: Query<&Transform, With<Enemy>>,
    mut state: ResMut<GameState>,
    mut commands: Commands,
) {
    let click = mouse.just_pressed(MouseButton::Left) || touches.any_just_pressed();
    if !click || state.gold < TURRET_COST { return; }
    let Ok(window) = windows.get_single() else { return };
    let Ok((cam, cam_tf)) = camera_q.get_single() else { return };
    let cursor = if let Some(pos) = window.cursor_position() { pos }
    else if let Some(touch) = touches.iter().next() { touch.position() }
    else { return };
    let Ok(world) = cam.viewport_to_world_2d(cam_tf, cursor) else { return };
    let col = ((world.x - GRID_X) / CELL).floor() as i32;
    let row = ((GRID_Y - world.y) / CELL).floor() as i32;
    if col < 0 || col >= COLS || row < 0 || row >= ROWS { return; }
    if PATH.contains(&(col, row)) { return; }
    let pos = grid_to_world(col, row);
    for ttf in &turrets {
        if (ttf.translation.x - pos.x).abs() < 10.0 && (ttf.translation.y - pos.y).abs() < 10.0 { return; }
    }
    let _ = &enemies;
    state.gold -= TURRET_COST;
    commands.spawn((
        Sprite { color: Color::srgb(0.3, 0.6, 0.9), custom_size: Some(Vec2::splat(CELL - 8.0)), ..default() },
        Transform::from_xyz(pos.x, pos.y, 0.5), Turret { cooldown: 0.0 }, GameEntity,
    ));
}

pub fn spawn_enemies(time: Res<Time>, mut state: ResMut<GameState>, mut commands: Commands) {
    state.wave_timer -= time.delta_secs();
    if state.wave_timer <= 0.0 && state.spawned >= state.enemies_per_wave {
        state.wave += 1;
        state.enemies_per_wave += 1;
        state.spawned = 0;
        state.wave_timer = WAVE_INTERVAL;
    }
    if state.spawned < state.enemies_per_wave {
        state.spawn_cd -= time.delta_secs();
        if state.spawn_cd <= 0.0 {
            state.spawn_cd = 1.0;
            state.spawned += 1;
            let start = path_world(0);
            let hp = 2 + state.wave;
            commands.spawn((
                Sprite { color: Color::srgb(0.9, 0.25, 0.2), custom_size: Some(Vec2::splat(20.0)), ..default() },
                Transform::from_xyz(start.x, start.y, 1.0),
                Enemy { hp, path_idx: 0, progress: 0.0 }, GameEntity,
            ));
        }
    }
}

pub fn move_enemies(
    time: Res<Time>, mut state: ResMut<GameState>, mut commands: Commands,
    mut eq: Query<(Entity, &mut Transform, &mut Enemy)>,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    let dt = time.delta_secs();
    for (e, mut tf, mut enemy) in &mut eq {
        if enemy.path_idx + 1 >= PATH.len() {
            commands.entity(e).despawn();
            state.lives -= 1;
            if state.lives <= 0 { next_state.set(crate::AppState::GameOver); return; }
            continue;
        }
        let target = path_world(enemy.path_idx + 1);
        let cur = Vec2::new(tf.translation.x, tf.translation.y);
        let diff = target - cur;
        let dist = diff.length();
        if dist < 3.0 { enemy.path_idx += 1; }
        else {
            let step = (diff / dist) * ENEMY_SPEED * dt;
            tf.translation.x += step.x;
            tf.translation.y += step.y;
        }
    }
}

pub fn turret_fire(
    time: Res<Time>, mut turrets: Query<(&Transform, &mut Turret)>,
    enemies: Query<&Transform, With<Enemy>>, mut commands: Commands,
) {
    let dt = time.delta_secs();
    for (ttf, mut turret) in &mut turrets {
        turret.cooldown -= dt;
        if turret.cooldown > 0.0 { continue; }
        let tpos = Vec2::new(ttf.translation.x, ttf.translation.y);
        let mut nearest: Option<(f32, Vec2)> = None;
        for etf in &enemies {
            let epos = Vec2::new(etf.translation.x, etf.translation.y);
            let d = tpos.distance(epos);
            if d < TURRET_RANGE && (nearest.is_none() || d < nearest.unwrap().0) {
                nearest = Some((d, epos));
            }
        }
        if let Some((_, epos)) = nearest {
            turret.cooldown = TURRET_COOLDOWN;
            let dir = (epos - tpos).normalize();
            commands.spawn((
                Sprite { color: Color::srgb(1.0, 1.0, 0.4), custom_size: Some(Vec2::splat(6.0)), ..default() },
                Transform::from_xyz(tpos.x, tpos.y, 0.8),
                Bullet { dx: dir.x * BULLET_SPEED, dy: dir.y * BULLET_SPEED }, GameEntity,
            ));
        }
    }
}

pub fn move_bullets(time: Res<Time>, mut commands: Commands, mut bq: Query<(Entity, &mut Transform, &Bullet)>) {
    let dt = time.delta_secs();
    for (e, mut tf, b) in &mut bq {
        tf.translation.x += b.dx * dt;
        tf.translation.y += b.dy * dt;
        if tf.translation.x.abs() > 500.0 || tf.translation.y.abs() > 350.0 {
            commands.entity(e).despawn();
        }
    }
}

pub fn bullet_hit(
    mut commands: Commands, mut state: ResMut<GameState>,
    bq: Query<(Entity, &Transform), With<Bullet>>,
    mut eq: Query<(Entity, &Transform, &mut Enemy)>,
) {
    for (be, btf) in &bq {
        for (ee, etf, mut enemy) in &mut eq {
            let dx = (btf.translation.x - etf.translation.x).abs();
            let dy = (btf.translation.y - etf.translation.y).abs();
            if dx < 16.0 && dy < 16.0 {
                commands.entity(be).despawn();
                enemy.hp -= 1;
                if enemy.hp <= 0 {
                    commands.entity(ee).despawn();
                    state.score += 25;
                    state.gold += 5;
                }
                break;
            }
        }
    }
}

pub fn update_score(state: Res<GameState>, mut bridge: ResMut<BevyBridge>) {
    bridge.current_score = state.score;
}

pub fn update_hud(
    state: Res<GameState>,
    mut sq: Query<&mut Text, (With<ScoreText>, Without<InfoText>)>,
    mut iq: Query<&mut Text, With<InfoText>>,
) {
    for mut t in &mut sq { **t = format!("Score: {}", state.score); }
    for mut t in &mut iq {
        **t = format!("Gold: {} | Lives: {} | Wave: {}", state.gold, state.lives, state.wave);
    }
}

// Cleanup
pub fn cleanup(mut commands: Commands, q: Query<Entity, With<GameEntity>>) {
    for e in &q { commands.entity(e).despawn(); }
    commands.remove_resource::<GameState>();
}
