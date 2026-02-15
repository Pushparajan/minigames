use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;
use crate::pixar::{self, PixarAssets, CharacterConfig, palette};
use crate::asset_loader::CustomAssets;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GROUND_Y: f32 = -180.0;
const ROVER_X: f32 = -200.0;
const ROVER_SIZE: Vec2 = Vec2::new(50.0, 24.0);
const SEGMENT_W: f32 = 60.0;
const NUM_SEGMENTS: i32 = 20;
const BASE_SPEED: f32 = 120.0;
const MAX_SPEED: f32 = 400.0;
const ACCEL: f32 = 200.0;
const BRAKE: f32 = 300.0;
const DRAG: f32 = 30.0;
const FUEL_MAX: f32 = 100.0;
const FUEL_DRAIN: f32 = 3.0;
const FUEL_ACCEL_DRAIN: f32 = 8.0;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

#[derive(Component)]
pub struct GameEntity;

#[derive(Component)]
struct Rover {
    velocity: f32,
    fuel: f32,
}

#[derive(Component)]
struct TerrainSegment {
    index: i32,
}

#[derive(Component)]
struct FuelText;

#[derive(Component)]
struct DistText;

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
            Transform::from_xyz(0.0, 0.0, -1.0),
            GameEntity,
        ));
    } else {
        commands.spawn((
            Sprite { color: palette::NIGHT_BG, custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
            Transform::from_xyz(0.0, 0.0, -1.0),
            GameEntity,
        ));
    }

    // Rover
    pixar::spawn_character(
        &mut commands,
        &pixar_assets,
        &CharacterConfig::vehicle(palette::HERO_ORANGE, ROVER_SIZE),
        Vec3::new(ROVER_X, GROUND_Y, 2.0),
        (Rover { velocity: BASE_SPEED, fuel: FUEL_MAX }, GameEntity),
    );

    // Terrain segments
    for i in 0..NUM_SEGMENTS {
        commands.spawn((
            Sprite { color: palette::GROUND_BROWN, custom_size: Some(Vec2::new(SEGMENT_W + 2.0, 200.0)), ..default() },
            Transform::from_xyz(0.0, GROUND_Y - 100.0, 0.0),
            TerrainSegment { index: i },
            GameEntity,
        ));
    }

    // HUD
    commands.spawn((
        Text::new("Fuel: 100%"), TextFont { font_size: 20.0, ..default() },
        TextColor(Color::srgb(0.2, 0.9, 0.3)),
        Node { position_type: PositionType::Absolute, top: Val::Px(10.0), left: Val::Px(10.0), ..default() },
        FuelText, GameEntity,
    ));
    commands.spawn((
        Text::new("Distance: 0"), TextFont { font_size: 20.0, ..default() },
        TextColor(Color::srgb(0.9, 0.85, 0.3)),
        Node { position_type: PositionType::Absolute, top: Val::Px(35.0), left: Val::Px(10.0), ..default() },
        DistText, GameEntity,
    ));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn terrain_height(x_world: f32, phase: f32) -> f32 {
    let t = (x_world * 0.008) + phase;
    GROUND_Y + (t.sin() * 40.0) + ((t * 2.3).sin() * 20.0)
}

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

pub fn rover_input(
    keys: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
    time: Res<Time>,
    mut q: Query<&mut Rover>,
) {
    let dt = time.delta_secs();
    for mut r in &mut q {
        let accel = keys.pressed(KeyCode::ArrowRight) || mouse.pressed(MouseButton::Left);
        let brake = keys.pressed(KeyCode::ArrowLeft);
        if accel && r.fuel > 0.0 {
            r.velocity = (r.velocity + ACCEL * dt).min(MAX_SPEED);
            r.fuel = (r.fuel - FUEL_ACCEL_DRAIN * dt).max(0.0);
        } else if brake {
            r.velocity = (r.velocity - BRAKE * dt).max(0.0);
        } else {
            r.velocity = (r.velocity - DRAG * dt).max(0.0);
        }
        if !accel {
            r.fuel = (r.fuel - FUEL_DRAIN * dt).max(0.0);
        }
    }
}

pub fn move_world(
    time: Res<Time>,
    mut state: ResMut<GameState>,
    rover_q: Query<&Rover>,
) {
    let dt = time.delta_secs();
    if let Ok(r) = rover_q.get_single() {
        state.scroll_offset += r.velocity * dt;
        state.distance += r.velocity * dt;
    }
}

pub fn update_terrain(
    state: Res<GameState>,
    mut q: Query<(&mut Transform, &TerrainSegment)>,
) {
    let base_x = (state.scroll_offset / SEGMENT_W).floor() as i32;
    for (mut tf, seg) in &mut q {
        let world_i = base_x + seg.index - NUM_SEGMENTS / 2;
        let wx = (world_i as f32) * SEGMENT_W - (state.scroll_offset % SEGMENT_W);
        let h = terrain_height((world_i as f32) * SEGMENT_W, state.phase);
        tf.translation.x = wx;
        tf.translation.y = h - 100.0;
    }
}

pub fn rover_follow_terrain(
    state: Res<GameState>,
    mut q: Query<&mut Transform, With<Rover>>,
) {
    for mut tf in &mut q {
        let wx = state.scroll_offset + ROVER_X;
        let h = terrain_height(wx, state.phase);
        tf.translation.y = h + ROVER_SIZE.y / 2.0;
        let h2 = terrain_height(wx + 10.0, state.phase);
        let angle = ((h2 - h) / 10.0).atan();
        tf.rotation = Quat::from_rotation_z(angle);
    }
}

pub fn check_game_over(
    rover_q: Query<&Rover>,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    if let Ok(r) = rover_q.get_single() {
        if r.fuel <= 0.0 && r.velocity <= 0.1 {
            next_state.set(crate::AppState::GameOver);
        }
    }
}

pub fn update_score(state: Res<GameState>, mut bridge: ResMut<BevyBridge>) {
    bridge.current_score = (state.distance / 10.0) as i32;
}

pub fn update_hud(
    rover_q: Query<&Rover>,
    state: Res<GameState>,
    mut fuel_q: Query<&mut Text, (With<FuelText>, Without<DistText>)>,
    mut dist_q: Query<&mut Text, (With<DistText>, Without<FuelText>)>,
) {
    if let Ok(r) = rover_q.get_single() {
        for mut t in &mut fuel_q {
            **t = format!("Fuel: {}%", r.fuel as i32);
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
    for e in &q {
        commands.entity(e).despawn();
    }
    commands.remove_resource::<GameState>();
}
