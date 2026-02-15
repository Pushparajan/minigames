use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;
use crate::pixar::{self, PixarAssets, CharacterConfig, palette};
use crate::asset_loader::CustomAssets;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GROUND_Y: f32 = -250.0;
const PLAYER_X: f32 = -300.0;
const PLAYER_SIZE: Vec2 = Vec2::new(30.0, 50.0);
const GRAVITY: f32 = -1400.0;
const JUMP_VELOCITY: f32 = 600.0;
const BASE_SPEED: f32 = 300.0;
const SPEED_INCREASE: f32 = 5.0; // per second
const OBSTACLE_MIN_GAP: f32 = 250.0;
const OBSTACLE_MAX_GAP: f32 = 400.0;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/// Tag for everything spawned by this game (for bulk cleanup).
#[derive(Component)]
pub struct GameEntity;

#[derive(Component)]
struct Player {
    vy: f32,
    on_ground: bool,
}

#[derive(Component)]
struct Obstacle;

#[derive(Component)]
struct Ground;

#[derive(Component)]
struct ScoreText;

/// Tracks elapsed time and scroll speed.
#[derive(Resource)]
struct GameState {
    speed: f32,
    distance: f32,
    spawn_timer: f32,
    next_gap: f32,
}

// ---------------------------------------------------------------------------
// Setup – runs on `OnEnter(AppState::Playing)`
// ---------------------------------------------------------------------------

pub fn setup(mut commands: Commands, pixar_assets: Res<PixarAssets>, custom_assets: Res<CustomAssets>) {
    // -- Game state resource -----------------------------------------------
    commands.insert_resource(GameState {
        speed: BASE_SPEED,
        distance: 0.0,
        spawn_timer: 0.0,
        next_gap: OBSTACLE_MIN_GAP,
    });

    // -- Background --------------------------------------------------------
    let bg_sprite = if let Some(ref bg) = custom_assets.background {
        Sprite { image: bg.clone(), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() }
    } else {
        Sprite { color: palette::NIGHT_BG, custom_size: Some(Vec2::new(960.0, 640.0)), ..default() }
    };
    commands.spawn((bg_sprite, Transform::from_xyz(0.0, 0.0, -1.0), GameEntity));

    // -- Ground ------------------------------------------------------------
    commands.spawn((
        Sprite {
            color: palette::GROUND_GREEN,
            custom_size: Some(Vec2::new(960.0, 40.0)),
            ..default()
        },
        Transform::from_xyz(0.0, GROUND_Y - 20.0, 0.0),
        Ground,
        GameEntity,
    ));

    // -- Player ------------------------------------------------------------
    pixar::spawn_character(
        &mut commands,
        &pixar_assets,
        &CharacterConfig::hero(palette::HERO_BLUE, PLAYER_SIZE),
        Vec3::new(PLAYER_X, GROUND_Y + PLAYER_SIZE.y / 2.0, 1.0),
        (Player { vy: 0.0, on_ground: true }, GameEntity),
    );

    // -- HUD ---------------------------------------------------------------
    commands.spawn((
        Text::new("Score: 0"),
        TextFont {
            font_size: 24.0,
            ..default()
        },
        TextColor(Color::srgb(0.9, 0.85, 0.3)),
        Node {
            position_type: PositionType::Absolute,
            top: Val::Px(10.0),
            left: Val::Px(10.0),
            ..default()
        },
        ScoreText,
        GameEntity,
    ));

    // Spawn a couple of initial obstacles off-screen right.
    spawn_obstacle(&mut commands, &pixar_assets, 500.0, 60.0);
    spawn_obstacle(&mut commands, &pixar_assets, 850.0, 80.0);
}

// ---------------------------------------------------------------------------
// Systems (run every frame while Playing)
// ---------------------------------------------------------------------------

pub fn player_input(
    keys: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
    touches: Res<Touches>,
    mut q: Query<&mut Player>,
) {
    let jump = keys.just_pressed(KeyCode::Space)
        || keys.just_pressed(KeyCode::ArrowUp)
        || mouse.just_pressed(MouseButton::Left)
        || touches.any_just_pressed();

    for mut player in &mut q {
        if jump && player.on_ground {
            player.vy = JUMP_VELOCITY;
            player.on_ground = false;
        }
    }
}

pub fn player_physics(time: Res<Time>, mut q: Query<(&mut Transform, &mut Player)>) {
    let dt = time.delta_secs();
    for (mut tf, mut player) in &mut q {
        player.vy += GRAVITY * dt;
        tf.translation.y += player.vy * dt;

        let floor = GROUND_Y + PLAYER_SIZE.y / 2.0;
        if tf.translation.y <= floor {
            tf.translation.y = floor;
            player.vy = 0.0;
            player.on_ground = true;
        }
    }
}

pub fn scroll_world(
    time: Res<Time>,
    mut state: ResMut<GameState>,
    mut obstacles: Query<&mut Transform, With<Obstacle>>,
    mut commands: Commands,
    entities: Query<Entity, With<Obstacle>>,
) {
    let dt = time.delta_secs();
    state.speed += SPEED_INCREASE * dt;
    state.distance += state.speed * dt;

    let scroll = state.speed * dt;
    for mut tf in &mut obstacles {
        tf.translation.x -= scroll;
    }

    // Despawn obstacles that have scrolled off the left edge.
    for (entity, tf) in entities.iter().zip(obstacles.iter()) {
        if tf.translation.x < -600.0 {
            commands.entity(entity).despawn();
        }
    }
}

pub fn spawn_obstacles(time: Res<Time>, mut state: ResMut<GameState>, mut commands: Commands, pixar_assets: Res<PixarAssets>) {
    let dt = time.delta_secs();
    state.spawn_timer += state.speed * dt;

    if state.spawn_timer >= state.next_gap {
        state.spawn_timer = 0.0;
        let mut rng = rand::thread_rng();
        let h = rng.gen_range(40.0..120.0);
        state.next_gap = rng.gen_range(OBSTACLE_MIN_GAP..OBSTACLE_MAX_GAP);
        spawn_obstacle(&mut commands, &pixar_assets, 550.0, h);
    }
}

pub fn check_collisions(
    player_q: Query<&Transform, With<Player>>,
    obstacle_q: Query<(&Transform, &Sprite), With<Obstacle>>,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    let Ok(ptf) = player_q.get_single() else {
        return;
    };
    let phalf = PLAYER_SIZE / 2.0;

    for (otf, sprite) in &obstacle_q {
        let osize = sprite.custom_size.unwrap_or(Vec2::new(30.0, 60.0));
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
    bridge.current_score = state.distance as i32;
}

pub fn update_hud(state: Res<GameState>, mut q: Query<&mut Text, With<ScoreText>>) {
    for mut text in &mut q {
        **text = format!("Score: {}", state.distance as i32);
    }
}

// ---------------------------------------------------------------------------
// Cleanup – runs on `OnExit(AppState::Playing)`
// ---------------------------------------------------------------------------

pub fn cleanup(mut commands: Commands, q: Query<Entity, With<GameEntity>>) {
    for e in &q {
        commands.entity(e).despawn();
    }
    commands.remove_resource::<GameState>();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn spawn_obstacle(commands: &mut Commands, pixar_assets: &PixarAssets, x: f32, height: f32) {
    commands.spawn((
        pixar::round_sprite(pixar_assets, palette::VILLAIN_RED, Vec2::new(30.0, height)),
        Transform::from_xyz(x, GROUND_Y + height / 2.0, 0.5),
        Obstacle,
        GameEntity,
    ));
}
