use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;
use crate::pixar::{self, PixarAssets, CharacterConfig, palette};
use crate::asset_loader::CustomAssets;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAYER_X: f32 = -200.0;
const PLAYER_SIZE: Vec2 = Vec2::new(24.0, 24.0);
const WALL_WIDTH: f32 = 40.0;
const GAP_HEIGHT: f32 = 120.0;
const SCROLL_SPEED: f32 = 200.0;
const GRAVITY_STRENGTH: f32 = 600.0;
const CEILING_Y: f32 = 280.0;
const FLOOR_Y: f32 = -280.0;
const HALF_W: f32 = 480.0;
const BORDER_THICKNESS: f32 = 20.0;
const SPAWN_DISTANCE: f32 = 300.0;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

#[derive(Component)]
pub struct GameEntity;

#[derive(Component)]
struct Player { vy: f32, gravity_dir: f32 }

#[derive(Component)]
struct Obstacle;

#[derive(Component)]
struct Border;

#[derive(Component)]
struct ScoreText;

#[derive(Resource)]
struct GameState { scroll_x: f32, spawn_timer: f32 }

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

pub fn setup(mut commands: Commands, pixar_assets: Res<PixarAssets>, custom_assets: Res<CustomAssets>) {
    commands.insert_resource(GameState { scroll_x: 0.0, spawn_timer: 0.0 });

    // Background
    let bg_sprite = if let Some(ref bg) = custom_assets.background {
        Sprite { image: bg.clone(), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() }
    } else {
        Sprite { color: palette::NIGHT_BG, custom_size: Some(Vec2::new(960.0, 640.0)), ..default() }
    };
    commands.spawn((bg_sprite, Transform::from_xyz(0.0, 0.0, -1.0), GameEntity));

    // Ceiling
    commands.spawn((
        Sprite { color: palette::GROUND_GREEN, custom_size: Some(Vec2::new(960.0, BORDER_THICKNESS)), ..default() },
        Transform::from_xyz(0.0, CEILING_Y + BORDER_THICKNESS / 2.0, 0.0), Border, GameEntity,
    ));

    // Floor
    commands.spawn((
        Sprite { color: palette::GROUND_GREEN, custom_size: Some(Vec2::new(960.0, BORDER_THICKNESS)), ..default() },
        Transform::from_xyz(0.0, FLOOR_Y - BORDER_THICKNESS / 2.0, 0.0), Border, GameEntity,
    ));

    // Player
    pixar::spawn_character(
        &mut commands,
        &pixar_assets,
        &CharacterConfig::hero(palette::HERO_PURPLE, PLAYER_SIZE),
        Vec3::new(PLAYER_X, 0.0, 1.0),
        (Player { vy: 0.0, gravity_dir: -1.0 }, GameEntity),
    );

    // HUD
    commands.spawn((
        Text::new("Score: 0"),
        TextFont { font_size: 24.0, ..default() },
        TextColor(Color::srgb(0.9, 0.85, 0.3)),
        Node { position_type: PositionType::Absolute, top: Val::Px(10.0), left: Val::Px(10.0), ..default() },
        ScoreText, GameEntity,
    ));

    // Initial obstacles
    spawn_wall_pair(&mut commands, &pixar_assets, 300.0);
    spawn_wall_pair(&mut commands, &pixar_assets, 600.0);
}

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

pub fn player_input(
    keys: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
    touches: Res<Touches>,
    mut pq: Query<&mut Player>,
) {
    let flip = keys.just_pressed(KeyCode::Space)
        || mouse.just_pressed(MouseButton::Left)
        || touches.any_just_pressed();

    if flip {
        for mut p in &mut pq {
            p.gravity_dir *= -1.0;
        }
    }
}

pub fn player_physics(
    time: Res<Time>,
    mut pq: Query<(&mut Transform, &mut Player)>,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    let dt = time.delta_secs();
    for (mut tf, mut p) in &mut pq {
        p.vy += GRAVITY_STRENGTH * p.gravity_dir * dt;
        tf.translation.y += p.vy * dt;

        // Hit ceiling/floor = game over
        if tf.translation.y + PLAYER_SIZE.y / 2.0 > CEILING_Y {
            next_state.set(crate::AppState::GameOver);
            return;
        }
        if tf.translation.y - PLAYER_SIZE.y / 2.0 < FLOOR_Y {
            next_state.set(crate::AppState::GameOver);
            return;
        }
    }
}

pub fn scroll_world(
    time: Res<Time>,
    mut state: ResMut<GameState>,
    mut oq: Query<&mut Transform, With<Obstacle>>,
    mut commands: Commands,
    entities: Query<Entity, With<Obstacle>>,
) {
    let dt = time.delta_secs();
    let scroll = SCROLL_SPEED * dt;
    state.scroll_x += scroll;

    for mut tf in &mut oq {
        tf.translation.x -= scroll;
    }

    // Despawn off-screen left
    for (entity, tf) in entities.iter().zip(oq.iter()) {
        if tf.translation.x < -HALF_W - 60.0 {
            commands.entity(entity).despawn();
        }
    }
}

pub fn spawn_obstacles(time: Res<Time>, mut state: ResMut<GameState>, mut commands: Commands, pixar_assets: Res<PixarAssets>) {
    state.spawn_timer += SCROLL_SPEED * time.delta_secs();
    if state.spawn_timer >= SPAWN_DISTANCE {
        state.spawn_timer = 0.0;
        spawn_wall_pair(&mut commands, &pixar_assets, HALF_W + 60.0);
    }
}

pub fn check_collisions(
    pq: Query<&Transform, With<Player>>,
    oq: Query<(&Transform, &Sprite), With<Obstacle>>,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    let Ok(ptf) = pq.get_single() else { return };
    let phalf = PLAYER_SIZE / 2.0;

    for (otf, sprite) in &oq {
        let osize = sprite.custom_size.unwrap_or(Vec2::new(WALL_WIDTH, 200.0));
        let ohalf = osize / 2.0;

        let overlap_x = (ptf.translation.x - otf.translation.x).abs() < phalf.x + ohalf.x;
        let overlap_y = (ptf.translation.y - otf.translation.y).abs() < phalf.y + ohalf.y;

        if overlap_x && overlap_y {
            next_state.set(crate::AppState::GameOver);
            return;
        }
    }
}

pub fn update_score(state: Res<GameState>, mut bridge: ResMut<BevyBridge>) {
    bridge.current_score = (state.scroll_x / 10.0) as i32;
}

pub fn update_hud(state: Res<GameState>, mut q: Query<&mut Text, With<ScoreText>>) {
    let score = (state.scroll_x / 10.0) as i32;
    for mut t in &mut q { **t = format!("Score: {}", score); }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

pub fn cleanup(mut commands: Commands, q: Query<Entity, With<GameEntity>>) {
    for e in &q { commands.entity(e).despawn(); }
    commands.remove_resource::<GameState>();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn spawn_wall_pair(commands: &mut Commands, pixar_assets: &PixarAssets, x: f32) {
    let mut rng = rand::thread_rng();
    let gap_center = rng.gen_range(FLOOR_Y + 80.0..CEILING_Y - 80.0);
    let gap_top = gap_center + GAP_HEIGHT / 2.0;
    let gap_bot = gap_center - GAP_HEIGHT / 2.0;

    // Top wall: from gap_top to CEILING_Y
    let top_h = CEILING_Y - gap_top;
    if top_h > 2.0 {
        commands.spawn((
            pixar::round_sprite(pixar_assets, palette::VILLAIN_RED, Vec2::new(WALL_WIDTH, top_h)),
            Transform::from_xyz(x, gap_top + top_h / 2.0, 0.5), Obstacle, GameEntity,
        ));
    }

    // Bottom wall: from FLOOR_Y to gap_bot
    let bot_h = gap_bot - FLOOR_Y;
    if bot_h > 2.0 {
        commands.spawn((
            pixar::round_sprite(pixar_assets, palette::VILLAIN_RED, Vec2::new(WALL_WIDTH, bot_h)),
            Transform::from_xyz(x, FLOOR_Y + bot_h / 2.0, 0.5), Obstacle, GameEntity,
        ));
    }
}
