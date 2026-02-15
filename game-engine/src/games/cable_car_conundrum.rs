use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CAR_SIZE: Vec2 = Vec2::new(36.0, 24.0);
const OBS_SIZE: Vec2 = Vec2::new(30.0, 30.0);
const COLLECT_SIZE: Vec2 = Vec2::new(20.0, 20.0);
const ACCEL_RATE: f32 = 1.5;
const BRAKE_RATE: f32 = 2.0;
const MAX_VEL: f32 = 4.0;
const DANGER_SPEED: f32 = 1.5;
const NUM_WAYPOINTS: usize = 20;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

#[derive(Component)]
pub struct GameEntity;

#[derive(Component)]
struct CableCar {
    path_t: f32,
    velocity: f32,
    passengers: i32,
}

#[derive(Component)]
struct Waypoint {
    index: usize,
}

#[derive(Component)]
struct Obstacle {
    path_t: f32,
}

#[derive(Component)]
struct Collectible {
    path_t: f32,
}

#[derive(Component)]
struct CableLine;

#[derive(Component)]
struct HudText;

#[derive(Resource)]
struct GameState {
    score: i32,
    waypoints: Vec<Vec2>,
    finished: bool,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn path_position(waypoints: &[Vec2], t: f32) -> Vec2 {
    let count = waypoints.len();
    if count < 2 { return Vec2::ZERO; }
    let max_t = (count - 1) as f32;
    let clamped = t.clamp(0.0, max_t);
    let i = (clamped as usize).min(count - 2);
    let frac = clamped - i as f32;
    waypoints[i].lerp(waypoints[i + 1], frac)
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

pub fn setup(mut commands: Commands) {
    let mut rng = rand::thread_rng();

    // Generate waypoints along a winding path
    let mut wps = Vec::with_capacity(NUM_WAYPOINTS);
    for i in 0..NUM_WAYPOINTS {
        let frac = i as f32 / (NUM_WAYPOINTS - 1) as f32;
        let x = -380.0 + frac * 760.0;
        let y = (frac * 3.0).sin() * 120.0 + rng.gen_range(-30.0..30.0);
        wps.push(Vec2::new(x, y));
    }

    // Draw cable line segments
    for i in 0..(NUM_WAYPOINTS - 1) {
        let a = wps[i];
        let b = wps[i + 1];
        let mid = (a + b) / 2.0;
        let diff = b - a;
        let len = diff.length();
        let angle = diff.y.atan2(diff.x);
        commands.spawn((
            Sprite { color: Color::srgb(0.5, 0.5, 0.5), custom_size: Some(Vec2::new(len, 3.0)), ..default() },
            Transform::from_xyz(mid.x, mid.y, 0.0).with_rotation(Quat::from_rotation_z(angle)),
            CableLine, GameEntity,
        ));
    }

    // Waypoint markers (small dots)
    for (i, wp) in wps.iter().enumerate() {
        commands.spawn((
            Sprite { color: Color::srgb(0.6, 0.6, 0.6), custom_size: Some(Vec2::new(8.0, 8.0)), ..default() },
            Transform::from_xyz(wp.x, wp.y, 0.1),
            Waypoint { index: i }, GameEntity,
        ));
    }

    // Obstacles (red zones at certain path positions)
    let num_obs = rng.gen_range(5..9);
    for _ in 0..num_obs {
        let pt = rng.gen_range(2.0..(NUM_WAYPOINTS - 2) as f32);
        let pos = path_position(&wps, pt);
        commands.spawn((
            Sprite { color: Color::srgba(0.9, 0.15, 0.15, 0.7), custom_size: Some(OBS_SIZE), ..default() },
            Transform::from_xyz(pos.x, pos.y, 0.3),
            Obstacle { path_t: pt }, GameEntity,
        ));
    }

    // Collectibles (green circles)
    let num_col = rng.gen_range(8..14);
    for _ in 0..num_col {
        let pt = rng.gen_range(1.0..(NUM_WAYPOINTS - 1) as f32);
        let pos = path_position(&wps, pt);
        let offset_y = rng.gen_range(-20.0..20.0);
        commands.spawn((
            Sprite { color: Color::srgb(0.2, 0.9, 0.3), custom_size: Some(COLLECT_SIZE), ..default() },
            Transform::from_xyz(pos.x, pos.y + offset_y, 0.3),
            Collectible { path_t: pt }, GameEntity,
        ));
    }

    // Background
    commands.spawn((
        Sprite { color: Color::srgb(0.07, 0.07, 0.15), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
        Transform::from_xyz(0.0, 0.0, -1.0), GameEntity,
    ));

    // Cable car
    let start = path_position(&wps, 0.0);
    commands.spawn((
        Sprite { color: Color::srgb(0.2, 0.6, 0.9), custom_size: Some(CAR_SIZE), ..default() },
        Transform::from_xyz(start.x, start.y, 2.0),
        CableCar { path_t: 0.0, velocity: 0.5, passengers: 5 }, GameEntity,
    ));

    commands.insert_resource(GameState { score: 0, waypoints: wps, finished: false });

    // HUD
    commands.spawn((
        Text::new("Passengers: 5 | Score: 0"),
        TextFont { font_size: 20.0, ..default() },
        TextColor(Color::srgb(0.9, 0.85, 0.3)),
        Node { position_type: PositionType::Absolute, top: Val::Px(10.0), left: Val::Px(10.0), ..default() },
        HudText, GameEntity,
    ));
}

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

pub fn car_input(
    keys: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
    time: Res<Time>,
    mut q: Query<&mut CableCar>,
) {
    let dt = time.delta_secs();
    for mut car in &mut q {
        let accel = keys.pressed(KeyCode::Space) || mouse.pressed(MouseButton::Left);
        if accel {
            car.velocity = (car.velocity + ACCEL_RATE * dt).min(MAX_VEL);
        } else {
            car.velocity = (car.velocity - BRAKE_RATE * dt).max(0.2);
        }
    }
}

pub fn move_car(
    time: Res<Time>,
    state: Res<GameState>,
    mut q: Query<(&mut Transform, &mut CableCar)>,
) {
    let dt = time.delta_secs();
    for (mut tf, mut car) in &mut q {
        car.path_t += car.velocity * dt;
        let pos = path_position(&state.waypoints, car.path_t);
        tf.translation.x = pos.x;
        tf.translation.y = pos.y;
        // Rotate to face direction of travel
        let ahead = path_position(&state.waypoints, car.path_t + 0.1);
        let diff = ahead - pos;
        if diff.length() > 0.01 {
            tf.rotation = Quat::from_rotation_z(diff.y.atan2(diff.x));
        }
    }
}

pub fn check_obstacles(
    mut car_q: Query<&mut CableCar>,
    obs_q: Query<(Entity, &Obstacle)>,
    mut commands: Commands,
) {
    for mut car in &mut car_q {
        for (oe, obs) in &obs_q {
            let dist = (car.path_t - obs.path_t).abs();
            if dist < 0.3 {
                if car.velocity > DANGER_SPEED {
                    car.passengers -= 1;
                    car.velocity *= 0.4;
                }
                commands.entity(oe).despawn();
            }
        }
    }
}

pub fn check_collectibles(
    mut state: ResMut<GameState>,
    car_q: Query<&CableCar>,
    col_q: Query<(Entity, &Collectible)>,
    mut commands: Commands,
) {
    for car in &car_q {
        for (ce, col) in &col_q {
            let dist = (car.path_t - col.path_t).abs();
            if dist < 0.4 {
                state.score += 50;
                commands.entity(ce).despawn();
            }
        }
    }
}

pub fn check_finish(
    mut state: ResMut<GameState>,
    car_q: Query<&CableCar>,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    if state.finished { return; }
    for car in &car_q {
        if car.passengers <= 0 {
            next_state.set(crate::AppState::GameOver);
            state.finished = true;
            return;
        }
        let max_t = (NUM_WAYPOINTS - 1) as f32;
        if car.path_t >= max_t - 0.1 {
            state.score += car.passengers * 200;
            state.finished = true;
            next_state.set(crate::AppState::GameOver);
        }
    }
}

pub fn update_score(state: Res<GameState>, mut bridge: ResMut<BevyBridge>) {
    bridge.current_score = state.score;
}

pub fn update_hud(
    car_q: Query<&CableCar>,
    state: Res<GameState>,
    mut q: Query<&mut Text, With<HudText>>,
) {
    if let Ok(car) = car_q.get_single() {
        let pct = (car.path_t / (NUM_WAYPOINTS - 1) as f32 * 100.0) as i32;
        for mut t in &mut q {
            **t = format!(
                "Passengers: {} | Score: {} | Progress: {}%",
                car.passengers, state.score, pct.min(100)
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

pub fn cleanup(mut commands: Commands, q: Query<Entity, With<GameEntity>>) {
    for e in &q { commands.entity(e).despawn(); }
    commands.remove_resource::<GameState>();
}
