use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TABLE_W: f32 = 700.0;
const TABLE_H: f32 = 380.0;
const HALF_W: f32 = TABLE_W / 2.0;
const HALF_H: f32 = TABLE_H / 2.0;
const BALL_R: f32 = 10.0;
const POCKET_R: f32 = 20.0;
const FRICTION: f32 = 0.985;
const MAX_POWER: f32 = 600.0;
const MIN_SPEED: f32 = 3.0;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

#[derive(Component)]
pub struct GameEntity;

#[derive(Component)]
struct Ball { vx: f32, vy: f32, is_cue: bool, sunk: bool }

#[derive(Component)]
struct Pocket { x: f32, y: f32 }

#[derive(Component)]
struct PowerLine;

#[derive(Component)]
struct ScoreText;

#[derive(Resource)]
struct GameState {
    score: i32,
    pocketed: i32,
    dragging: bool,
    drag_start: Vec2,
    drag_end: Vec2,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn any_moving(bq: &Query<(&Transform, &Ball)>) -> bool {
    bq.iter().any(|(_, b)| !b.sunk && (b.vx.abs() > MIN_SPEED || b.vy.abs() > MIN_SPEED))
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

pub fn setup(mut commands: Commands) {
    commands.insert_resource(GameState {
        score: 0, pocketed: 0, dragging: false,
        drag_start: Vec2::ZERO, drag_end: Vec2::ZERO,
    });

    // Table background
    commands.spawn((
        Sprite { color: Color::srgb(0.1, 0.45, 0.2), custom_size: Some(Vec2::new(TABLE_W, TABLE_H)), ..default() },
        Transform::from_xyz(0.0, 0.0, 0.0),
        GameEntity,
    ));
    // Borders
    for (x, y, w, h) in [
        (0.0, HALF_H + 8.0, TABLE_W + 32.0, 16.0),
        (0.0, -HALF_H - 8.0, TABLE_W + 32.0, 16.0),
        (-HALF_W - 8.0, 0.0, 16.0, TABLE_H + 32.0),
        (HALF_W + 8.0, 0.0, 16.0, TABLE_H + 32.0),
    ] {
        commands.spawn((
            Sprite { color: Color::srgb(0.35, 0.2, 0.1), custom_size: Some(Vec2::new(w, h)), ..default() },
            Transform::from_xyz(x, y, 0.1),
            GameEntity,
        ));
    }

    // Pockets (6 total)
    let pocket_positions = [
        (-HALF_W, HALF_H), (0.0, HALF_H), (HALF_W, HALF_H),
        (-HALF_W, -HALF_H), (0.0, -HALF_H), (HALF_W, -HALF_H),
    ];
    for (px, py) in pocket_positions {
        commands.spawn((
            Sprite { color: Color::srgb(0.05, 0.05, 0.05), custom_size: Some(Vec2::splat(POCKET_R * 2.0)), ..default() },
            Transform::from_xyz(px, py, 0.2),
            Pocket { x: px, y: py },
            GameEntity,
        ));
    }

    // Cue ball
    commands.spawn((
        Sprite { color: Color::srgb(0.95, 0.95, 0.95), custom_size: Some(Vec2::splat(BALL_R * 2.0)), ..default() },
        Transform::from_xyz(-HALF_W * 0.5, 0.0, 1.0),
        Ball { vx: 0.0, vy: 0.0, is_cue: true, sunk: false },
        GameEntity,
    ));

    // 15 colored balls in triangle
    let colors = [
        Color::srgb(0.9, 0.1, 0.1), Color::srgb(0.1, 0.1, 0.8), Color::srgb(0.9, 0.5, 0.0),
        Color::srgb(0.1, 0.6, 0.1), Color::srgb(0.6, 0.1, 0.6), Color::srgb(0.8, 0.8, 0.1),
        Color::srgb(0.8, 0.2, 0.2), Color::srgb(0.1, 0.1, 0.1), Color::srgb(0.9, 0.6, 0.2),
        Color::srgb(0.2, 0.2, 0.8), Color::srgb(0.9, 0.3, 0.5), Color::srgb(0.4, 0.7, 0.3),
        Color::srgb(0.7, 0.3, 0.1), Color::srgb(0.3, 0.6, 0.7), Color::srgb(0.6, 0.6, 0.0),
    ];
    let start_x = HALF_W * 0.3;
    let spacing = BALL_R * 2.2;
    let mut idx = 0;
    for row in 0..5 {
        for col in 0..=row {
            if idx >= 15 { break; }
            let x = start_x + row as f32 * spacing;
            let y = (col as f32 - row as f32 / 2.0) * spacing;
            commands.spawn((
                Sprite { color: colors[idx], custom_size: Some(Vec2::splat(BALL_R * 2.0)), ..default() },
                Transform::from_xyz(x, y, 1.0),
                Ball { vx: 0.0, vy: 0.0, is_cue: false, sunk: false },
                GameEntity,
            ));
            idx += 1;
        }
    }

    // Power line (aim visual)
    commands.spawn((
        Sprite { color: Color::srgba(1.0, 1.0, 1.0, 0.4), custom_size: Some(Vec2::new(2.0, 0.0)), ..default() },
        Transform::from_xyz(0.0, 0.0, 2.0),
        PowerLine,
        GameEntity,
    ));

    // HUD
    commands.spawn((
        Text::new("Click+drag cue ball to shoot"),
        TextFont { font_size: 20.0, ..default() },
        TextColor(Color::srgb(0.9, 0.85, 0.3)),
        Node { position_type: PositionType::Absolute, top: Val::Px(8.0), left: Val::Px(8.0), ..default() },
        ScoreText, GameEntity,
    ));
}

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

pub fn handle_input(
    mouse: Res<ButtonInput<MouseButton>>,
    windows: Query<&Window>,
    camera_q: Query<(&Camera, &GlobalTransform)>,
    mut state: ResMut<GameState>,
    mut bq: Query<(&mut Ball, &Transform)>,
) {
    let moving = bq.iter().any(|(b, _)| !b.sunk && (b.vx.abs() > MIN_SPEED || b.vy.abs() > MIN_SPEED));
    if moving && !state.dragging { return; }

    let Ok(window) = windows.get_single() else { return };
    let Ok((camera, cam_tf)) = camera_q.get_single() else { return };
    let Some(cursor) = window.cursor_position().and_then(|p| camera.viewport_to_world_2d(cam_tf, p).ok()) else { return };

    if mouse.just_pressed(MouseButton::Left) {
        for (ref ball, tf) in bq.iter() {
            if ball.is_cue && !ball.sunk {
                let dist = ((tf.translation.x - cursor.x).powi(2) + (tf.translation.y - cursor.y).powi(2)).sqrt();
                if dist < BALL_R * 3.0 {
                    state.dragging = true;
                    state.drag_start = Vec2::new(tf.translation.x, tf.translation.y);
                    state.drag_end = cursor;
                }
            }
        }
    }

    if state.dragging {
        state.drag_end = cursor;
    }

    if mouse.just_released(MouseButton::Left) && state.dragging {
        state.dragging = false;
        let dir = state.drag_start - state.drag_end;
        let power = dir.length().min(300.0) / 300.0;
        if power > 0.02 {
            let norm = dir.normalize_or_zero();
            for (mut ball, _) in &mut bq {
                if ball.is_cue && !ball.sunk {
                    ball.vx = norm.x * power * MAX_POWER;
                    ball.vy = norm.y * power * MAX_POWER;
                }
            }
        }
    }
}

pub fn update_power_line(
    state: Res<GameState>,
    mut plq: Query<(&mut Transform, &mut Sprite), With<PowerLine>>,
) {
    let Ok((mut tf, mut sprite)) = plq.get_single_mut() else { return };
    if state.dragging {
        let mid = (state.drag_start + state.drag_end) / 2.0;
        let diff = state.drag_start - state.drag_end;
        let len = diff.length();
        let angle = diff.y.atan2(diff.x) - std::f32::consts::FRAC_PI_2;
        tf.translation = Vec3::new(mid.x, mid.y, 2.0);
        tf.rotation = Quat::from_rotation_z(angle);
        sprite.custom_size = Some(Vec2::new(2.0, len));
    } else {
        sprite.custom_size = Some(Vec2::new(0.0, 0.0));
    }
}

pub fn physics(
    time: Res<Time>,
    mut bq: Query<(&mut Ball, &mut Transform)>,
) {
    let dt = time.delta_secs();

    // Move balls
    let mut positions: Vec<(Entity, f32, f32, f32)> = Vec::new();
    // First pass: move and wall bounce
    for (mut ball, mut tf) in &mut bq {
        if ball.sunk { continue; }
        tf.translation.x += ball.vx * dt;
        tf.translation.y += ball.vy * dt;

        // Wall bounce
        if tf.translation.x - BALL_R < -HALF_W { tf.translation.x = -HALF_W + BALL_R; ball.vx = ball.vx.abs(); }
        if tf.translation.x + BALL_R > HALF_W { tf.translation.x = HALF_W - BALL_R; ball.vx = -ball.vx.abs(); }
        if tf.translation.y - BALL_R < -HALF_H { tf.translation.y = -HALF_H + BALL_R; ball.vy = ball.vy.abs(); }
        if tf.translation.y + BALL_R > HALF_H { tf.translation.y = HALF_H - BALL_R; ball.vy = -ball.vy.abs(); }

        // Friction
        ball.vx *= FRICTION;
        ball.vy *= FRICTION;
        if ball.vx.abs() < MIN_SPEED { ball.vx = 0.0; }
        if ball.vy.abs() < MIN_SPEED { ball.vy = 0.0; }
    }
}

pub fn ball_collisions(
    mut bq: Query<(Entity, &mut Ball, &mut Transform)>,
) {
    let data: Vec<(Entity, f32, f32, f32, f32, bool)> = bq.iter()
        .map(|(e, b, tf)| (e, tf.translation.x, tf.translation.y, b.vx, b.vy, b.sunk))
        .collect();

    for i in 0..data.len() {
        for j in (i + 1)..data.len() {
            if data[i].5 || data[j].5 { continue; }
            let dx = data[j].1 - data[i].1;
            let dy = data[j].2 - data[i].2;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist < BALL_R * 2.0 && dist > 0.01 {
                let nx = dx / dist;
                let ny = dy / dist;
                let dvx = data[i].3 - data[j].3;
                let dvy = data[i].4 - data[j].4;
                let dot = dvx * nx + dvy * ny;
                if dot > 0.0 {
                    // Elastic collision (equal mass)
                    let e_i = data[i].0;
                    let e_j = data[j].0;
                    if let Ok((_, mut bi, mut ti)) = bq.get_mut(e_i) {
                        bi.vx -= dot * nx;
                        bi.vy -= dot * ny;
                        ti.translation.x -= nx * (BALL_R * 2.0 - dist) / 2.0;
                        ti.translation.y -= ny * (BALL_R * 2.0 - dist) / 2.0;
                    }
                    if let Ok((_, mut bj, mut tj)) = bq.get_mut(e_j) {
                        bj.vx += dot * nx;
                        bj.vy += dot * ny;
                        tj.translation.x += nx * (BALL_R * 2.0 - dist) / 2.0;
                        tj.translation.y += ny * (BALL_R * 2.0 - dist) / 2.0;
                    }
                }
            }
        }
    }
}

pub fn check_pockets(
    mut state: ResMut<GameState>,
    pq: Query<&Pocket>,
    mut bq: Query<(&mut Ball, &mut Transform, &mut Visibility)>,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    for (mut ball, mut tf, mut vis) in &mut bq {
        if ball.sunk { continue; }
        for pocket in &pq {
            let dx = tf.translation.x - pocket.x;
            let dy = tf.translation.y - pocket.y;
            if (dx * dx + dy * dy).sqrt() < POCKET_R {
                if ball.is_cue {
                    // Reset cue ball
                    tf.translation.x = 0.0;
                    tf.translation.y = 0.0;
                    ball.vx = 0.0;
                    ball.vy = 0.0;
                } else {
                    ball.sunk = true;
                    ball.vx = 0.0;
                    ball.vy = 0.0;
                    *vis = Visibility::Hidden;
                    state.score += 100;
                    state.pocketed += 1;
                    if state.pocketed >= 15 {
                        next_state.set(crate::AppState::GameOver);
                    }
                }
                break;
            }
        }
    }
}

pub fn update_score(state: Res<GameState>, mut bridge: ResMut<BevyBridge>) {
    bridge.current_score = state.score;
}

pub fn update_hud(state: Res<GameState>, mut q: Query<&mut Text, With<ScoreText>>) {
    for mut t in &mut q {
        **t = format!("Score: {} | Pocketed: {}/15", state.score, state.pocketed);
    }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

pub fn cleanup(mut commands: Commands, q: Query<Entity, With<GameEntity>>) {
    for e in &q { commands.entity(e).despawn(); }
    commands.remove_resource::<GameState>();
}
