use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;
use crate::pixar::{self, PixarAssets, CharacterConfig, palette};
use crate::asset_loader::CustomAssets;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SPEED: f32 = 350.0;
const ACCEL: f32 = 200.0;
const BRAKE: f32 = 300.0;
const STEER_SPEED: f32 = 3.0;
const DRAG: f32 = 50.0;
const CAR_SIZE: Vec2 = Vec2::new(20.0, 32.0);
const WP_RADIUS: f32 = 50.0;
const OFF_TRACK_DIST: f32 = 120.0;
const LAPS_TO_WIN: i32 = 3;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

#[derive(Component)]
pub struct GameEntity;

#[derive(Component)]
struct PlayerCar {
    speed: f32,
    next_wp: usize,
    lap: i32,
}

#[derive(Component)]
struct AICar {
    path_t: f32,
    speed: f32,
}

#[derive(Component)]
struct Waypoint {
    index: usize,
}

#[derive(Component)]
struct TrackVisual;

#[derive(Component)]
struct ScoreText;

#[derive(Resource)]
struct GameState {
    score: i32,
    waypoints: Vec<Vec2>,
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

pub fn setup(mut commands: Commands, pixar_assets: Res<PixarAssets>, custom_assets: Res<CustomAssets>) {
    // Oval track waypoints
    let wps = build_waypoints();

    commands.insert_resource(GameState { score: 0, waypoints: wps.clone() });

    // Background
    if let Some(ref bg_handle) = custom_assets.background {
        commands.spawn((
            Sprite { image: bg_handle.clone(), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
            Transform::from_xyz(0.0, 0.0, -1.0),
            GameEntity,
        ));
    } else {
        commands.spawn((
            Sprite { color: palette::GROUND_GREEN, custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
            Transform::from_xyz(0.0, 0.0, -1.0),
            GameEntity,
        ));
    }

    // Track visuals (segments between waypoints) — props
    for i in 0..wps.len() {
        let p = wps[i];
        let track_size = Vec2::new(70.0, 70.0);
        let config = CharacterConfig::prop(Color::srgb(0.3, 0.3, 0.35), track_size, false);
        pixar::spawn_character(
            &mut commands,
            &pixar_assets,
            &config,
            Vec3::new(p.x, p.y, 0.0),
            (TrackVisual, GameEntity),
        );
        // Waypoint marker — small round prop
        commands.spawn((
            pixar::round_sprite(&pixar_assets, Color::srgb(0.9, 0.9, 0.2), Vec2::new(10.0, 10.0)),
            Transform::from_xyz(p.x, p.y, 0.1),
            Waypoint { index: i },
            GameEntity,
        ));
    }

    // Player car at first waypoint — vehicle with HERO_RED
    let start = wps[0];
    let player_config = CharacterConfig::vehicle(palette::HERO_RED, CAR_SIZE);
    pixar::spawn_character(
        &mut commands,
        &pixar_assets,
        &player_config,
        Vec3::new(start.x, start.y, 1.0),
        (PlayerCar { speed: 0.0, next_wp: 1, lap: 0 }, GameEntity),
    );

    // AI cars — vehicles with VILLAIN_PURPLE
    let mut rng = rand::thread_rng();
    for i in 0..3 {
        let t = (i as f32 + 1.0) * 0.25;
        let idx = ((t * wps.len() as f32) as usize) % wps.len();
        let p = wps[idx];
        let spd = rng.gen_range(100.0..180.0);
        let config = CharacterConfig::vehicle(palette::VILLAIN_PURPLE, CAR_SIZE);
        pixar::spawn_character(
            &mut commands,
            &pixar_assets,
            &config,
            Vec3::new(p.x, p.y, 0.9),
            (AICar { path_t: t, speed: spd }, GameEntity),
        );
    }

    // HUD
    commands.spawn((
        Text::new("Lap: 0/3 | Score: 0"),
        TextFont { font_size: 22.0, ..default() },
        TextColor(Color::srgb(0.9, 0.85, 0.3)),
        Node { position_type: PositionType::Absolute, top: Val::Px(10.0), left: Val::Px(10.0), ..default() },
        ScoreText,
        GameEntity,
    ));
}

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

pub fn player_drive(
    keys: Res<ButtonInput<KeyCode>>,
    time: Res<Time>,
    state: Res<GameState>,
    mut pq: Query<(&mut Transform, &mut PlayerCar)>,
) {
    let dt = time.delta_secs();
    let Ok((mut tf, mut car)) = pq.get_single_mut() else { return };

    // Steering
    if keys.pressed(KeyCode::ArrowLeft) {
        tf.rotate_z(STEER_SPEED * dt * (car.speed / MAX_SPEED).max(0.2));
    }
    if keys.pressed(KeyCode::ArrowRight) {
        tf.rotate_z(-STEER_SPEED * dt * (car.speed / MAX_SPEED).max(0.2));
    }

    // Accel / brake
    if keys.pressed(KeyCode::ArrowUp) {
        car.speed = (car.speed + ACCEL * dt).min(MAX_SPEED);
    } else if keys.pressed(KeyCode::ArrowDown) {
        car.speed = (car.speed - BRAKE * dt).max(0.0);
    } else {
        car.speed = (car.speed - DRAG * dt).max(0.0);
    }

    // Off-track check: slow down if far from all waypoints
    let pos = Vec2::new(tf.translation.x, tf.translation.y);
    let near = state.waypoints.iter().any(|wp| pos.distance(*wp) < OFF_TRACK_DIST);
    if !near {
        car.speed *= 0.95;
    }

    // Move in facing direction
    let angle = tf.rotation.to_euler(EulerRot::XYZ).2;
    let dir = Vec2::new(-angle.sin(), angle.cos());
    tf.translation.x += dir.x * car.speed * dt;
    tf.translation.y += dir.y * car.speed * dt;
}

pub fn check_waypoints(
    mut pq: Query<(&Transform, &mut PlayerCar)>,
    state: Res<GameState>,
    mut gs: ResMut<GameState>,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    let Ok((tf, mut car)) = pq.get_single_mut() else { return };
    let pos = Vec2::new(tf.translation.x, tf.translation.y);

    if car.next_wp < state.waypoints.len() {
        let wp = state.waypoints[car.next_wp];
        if pos.distance(wp) < WP_RADIUS {
            car.next_wp += 1;
            if car.next_wp >= state.waypoints.len() {
                car.next_wp = 0;
                car.lap += 1;
                gs.score += 300;
                if car.lap >= LAPS_TO_WIN {
                    next_state.set(crate::AppState::GameOver);
                }
            }
        }
    }
}

pub fn ai_drive(
    time: Res<Time>,
    state: Res<GameState>,
    mut ai: Query<(&mut Transform, &mut AICar)>,
) {
    let dt = time.delta_secs();
    let n = state.waypoints.len() as f32;
    for (mut tf, mut car) in &mut ai {
        car.path_t += (car.speed / (n * 60.0)) * dt * 60.0;
        if car.path_t >= 1.0 { car.path_t -= 1.0; }

        let idx = (car.path_t * n) as usize;
        let next_idx = (idx + 1) % state.waypoints.len();
        let frac = car.path_t * n - idx as f32;

        let a = state.waypoints[idx % state.waypoints.len()];
        let b = state.waypoints[next_idx];
        let pos = a.lerp(b, frac);
        tf.translation.x = pos.x;
        tf.translation.y = pos.y;

        // Face direction of travel
        let dir = (b - a).normalize_or_zero();
        let angle = dir.x.atan2(dir.y);
        tf.rotation = Quat::from_rotation_z(-angle);
    }
}

pub fn update_score(state: Res<GameState>, mut bridge: ResMut<BevyBridge>) {
    bridge.current_score = state.score;
}

pub fn update_hud(state: Res<GameState>, pq: Query<&PlayerCar>, mut sq: Query<&mut Text, With<ScoreText>>) {
    let Ok(car) = pq.get_single() else { return };
    for mut t in &mut sq {
        **t = format!("Lap: {}/{} | Score: {} | Speed: {:.0}", car.lap, LAPS_TO_WIN, state.score, car.speed);
    }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

pub fn cleanup(mut commands: Commands, q: Query<Entity, With<GameEntity>>) {
    for e in &q { commands.entity(e).despawn_recursive(); }
    commands.remove_resource::<GameState>();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn build_waypoints() -> Vec<Vec2> {
    // Oval track: 16 points in an ellipse
    let cx = 0.0_f32;
    let cy = 0.0_f32;
    let rx = 350.0_f32;
    let ry = 200.0_f32;
    let n = 16;
    (0..n)
        .map(|i| {
            let angle = (i as f32 / n as f32) * std::f32::consts::TAU;
            Vec2::new(cx + rx * angle.cos(), cy + ry * angle.sin())
        })
        .collect()
}
