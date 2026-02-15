use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;
use crate::pixar::{self, PixarAssets, CharacterConfig, palette};
use crate::asset_loader::CustomAssets;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GROUND_Y: f32 = -180.0;
const TRUCK_X: f32 = -200.0;
const TRUCK_SIZE: Vec2 = Vec2::new(60.0, 30.0);
const CARGO_SIZE: Vec2 = Vec2::new(40.0, 30.0);
const SEGMENT_W: f32 = 60.0;
const NUM_SEGMENTS: i32 = 20;
const MAX_SPEED: f32 = 350.0;
const ACCEL: f32 = 180.0;
const BRAKE: f32 = 280.0;
const DRAG: f32 = 40.0;
const BALANCE_RECOVERY: f32 = 0.3;
const SLOPE_FACTOR: f32 = 2.5;
const DAMAGE_THRESHOLD: f32 = 0.8;
const DAMAGE_RATE: f32 = 30.0;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

#[derive(Component)]
pub struct GameEntity;

#[derive(Component)]
struct Truck {
    velocity: f32,
}

#[derive(Component)]
struct Cargo {
    balance: f32,
    hp: f32,
}

#[derive(Component)]
struct TerrainSegment {
    index: i32,
}

#[derive(Component)]
struct HudBalance;

#[derive(Component)]
struct HudInfo;

#[derive(Resource)]
struct GameState {
    distance: f32,
    scroll_offset: f32,
    phase: f32,
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

pub fn setup(mut commands: Commands, pixar_assets: Res<PixarAssets>, custom_assets: Res<CustomAssets>) {
    commands.insert_resource(GameState {
        distance: 0.0,
        scroll_offset: 0.0,
        phase: rand::thread_rng().gen_range(0.0..100.0),
    });

    // Background
    if let Some(ref bg) = custom_assets.background {
        commands.spawn((
            Sprite { image: bg.clone(), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
            Transform::from_xyz(0.0, 0.0, -1.0), GameEntity,
        ));
    } else {
        commands.spawn((
            Sprite { color: palette::NIGHT_BG, custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
            Transform::from_xyz(0.0, 0.0, -1.0), GameEntity,
        ));
    }

    // Terrain
    for i in 0..NUM_SEGMENTS {
        commands.spawn((
            Sprite { color: palette::GROUND_BROWN, custom_size: Some(Vec2::new(SEGMENT_W + 2.0, 200.0)), ..default() },
            Transform::from_xyz(0.0, GROUND_Y - 100.0, 0.0),
            TerrainSegment { index: i }, GameEntity,
        ));
    }

    // Truck
    pixar::spawn_character(
        &mut commands,
        &pixar_assets,
        &CharacterConfig::vehicle(palette::HERO_BLUE, TRUCK_SIZE),
        Vec3::new(TRUCK_X, GROUND_Y, 2.0),
        (Truck { velocity: 100.0 }, GameEntity),
    );

    // Cargo (child visually but separate entity)
    commands.spawn((
        Sprite { color: palette::HERO_ORANGE, custom_size: Some(CARGO_SIZE), ..default() },
        Transform::from_xyz(TRUCK_X, GROUND_Y + 30.0, 3.0),
        Cargo { balance: 0.0, hp: 100.0 }, GameEntity,
    ));

    // HUD
    commands.spawn((
        Text::new("Balance: OK | HP: 100"),
        TextFont { font_size: 20.0, ..default() },
        TextColor(Color::srgb(0.9, 0.85, 0.3)),
        Node { position_type: PositionType::Absolute, top: Val::Px(10.0), left: Val::Px(10.0), ..default() },
        HudInfo, GameEntity,
    ));
    commands.spawn((
        Text::new("Distance: 0m"),
        TextFont { font_size: 20.0, ..default() },
        TextColor(Color::srgb(0.7, 0.9, 0.7)),
        Node { position_type: PositionType::Absolute, top: Val::Px(35.0), left: Val::Px(10.0), ..default() },
        HudBalance, GameEntity,
    ));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn terrain_height(x_world: f32, phase: f32) -> f32 {
    let t = (x_world * 0.01) + phase;
    GROUND_Y + (t.sin() * 50.0) + ((t * 3.1).sin() * 25.0)
}

fn terrain_slope(x_world: f32, phase: f32) -> f32 {
    let dx = 5.0;
    (terrain_height(x_world + dx, phase) - terrain_height(x_world, phase)) / dx
}

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

pub fn truck_input(
    keys: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
    time: Res<Time>,
    mut q: Query<&mut Truck>,
) {
    let dt = time.delta_secs();
    for mut tr in &mut q {
        let accel = keys.pressed(KeyCode::ArrowRight) || mouse.pressed(MouseButton::Left);
        let brake = keys.pressed(KeyCode::ArrowLeft);
        if accel {
            tr.velocity = (tr.velocity + ACCEL * dt).min(MAX_SPEED);
        } else if brake {
            tr.velocity = (tr.velocity - BRAKE * dt).max(0.0);
        } else {
            tr.velocity = (tr.velocity - DRAG * dt).max(0.0);
        }
    }
}

pub fn move_world(time: Res<Time>, mut state: ResMut<GameState>, q: Query<&Truck>) {
    let dt = time.delta_secs();
    if let Ok(tr) = q.get_single() {
        state.scroll_offset += tr.velocity * dt;
        state.distance += tr.velocity * dt;
    }
}

pub fn update_terrain(state: Res<GameState>, mut q: Query<(&mut Transform, &TerrainSegment)>) {
    let base = (state.scroll_offset / SEGMENT_W).floor() as i32;
    for (mut tf, seg) in &mut q {
        let wi = base + seg.index - NUM_SEGMENTS / 2;
        let wx = (wi as f32) * SEGMENT_W - (state.scroll_offset % SEGMENT_W);
        let h = terrain_height((wi as f32) * SEGMENT_W, state.phase);
        tf.translation.x = wx;
        tf.translation.y = h - 100.0;
    }
}

pub fn truck_follow(state: Res<GameState>, mut q: Query<&mut Transform, With<Truck>>) {
    for mut tf in &mut q {
        let wx = state.scroll_offset + TRUCK_X;
        let h = terrain_height(wx, state.phase);
        tf.translation.y = h + TRUCK_SIZE.y / 2.0;
        let slope = terrain_slope(wx, state.phase);
        tf.rotation = Quat::from_rotation_z(slope.atan());
    }
}

pub fn cargo_balance(
    time: Res<Time>,
    state: Res<GameState>,
    truck_q: Query<&Transform, With<Truck>>,
    mut cargo_q: Query<(&mut Transform, &mut Cargo), Without<Truck>>,
) {
    let dt = time.delta_secs();
    let wx = state.scroll_offset + TRUCK_X;
    let slope = terrain_slope(wx, state.phase);
    if let Ok(ttf) = truck_q.get_single() {
        for (mut tf, mut c) in &mut cargo_q {
            c.balance = (c.balance + slope * SLOPE_FACTOR * dt).clamp(-1.0, 1.0);
            c.balance -= c.balance * BALANCE_RECOVERY * dt;
            if c.balance.abs() > DAMAGE_THRESHOLD {
                c.hp -= DAMAGE_RATE * dt;
            }
            tf.translation.x = ttf.translation.x + c.balance * 15.0;
            tf.translation.y = ttf.translation.y + TRUCK_SIZE.y / 2.0 + CARGO_SIZE.y / 2.0;
            tf.rotation = Quat::from_rotation_z(c.balance * 0.4);
        }
    }
}

pub fn check_game_over(
    cargo_q: Query<&Cargo>,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    if let Ok(c) = cargo_q.get_single() {
        if c.hp <= 0.0 {
            next_state.set(crate::AppState::GameOver);
        }
    }
}

pub fn update_score(state: Res<GameState>, mut bridge: ResMut<BevyBridge>) {
    bridge.current_score = (state.distance / 10.0) as i32;
}

pub fn update_hud(
    cargo_q: Query<&Cargo>,
    state: Res<GameState>,
    mut info_q: Query<&mut Text, (With<HudInfo>, Without<HudBalance>)>,
    mut dist_q: Query<&mut Text, (With<HudBalance>, Without<HudInfo>)>,
) {
    if let Ok(c) = cargo_q.get_single() {
        let warn = if c.balance.abs() > DAMAGE_THRESHOLD { "DANGER" } else { "OK" };
        for mut t in &mut info_q {
            **t = format!("Balance: {} | Cargo HP: {}", warn, c.hp as i32);
        }
    }
    for mut t in &mut dist_q {
        **t = format!("Distance: {}m", (state.distance / 10.0) as i32);
    }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

pub fn cleanup(mut commands: Commands, q: Query<Entity, With<GameEntity>>) {
    for e in &q { commands.entity(e).despawn(); }
    commands.remove_resource::<GameState>();
}
