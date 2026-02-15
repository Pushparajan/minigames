use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;
use crate::pixar::{self, PixarAssets, CharacterConfig, palette};
use crate::asset_loader::CustomAssets;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GROUND_Y: f32 = -250.0;
const PLAYER_X: f32 = -250.0;
const PLAYER_SIZE: Vec2 = Vec2::new(28.0, 44.0);
const BULLET_SIZE: Vec2 = Vec2::new(10.0, 4.0);
const ENEMY_SIZE: Vec2 = Vec2::new(26.0, 36.0);
const GRAVITY: f32 = -1200.0;
const JUMP_VEL: f32 = 550.0;
const SCROLL_SPEED: f32 = 180.0;
const BULLET_SPEED: f32 = 500.0;
const ENEMY_SPEED: f32 = 140.0;
const SPAWN_INTERVAL: f32 = 1.6;
const HALF_W: f32 = 480.0;
const MAX_HP: i32 = 3;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

#[derive(Component)]
pub struct GameEntity;

#[derive(Component)]
struct Player { vy: f32, on_ground: bool }

#[derive(Component)]
struct Enemy;

#[derive(Component)]
struct Bullet;

#[derive(Component)]
struct GroundTile;

#[derive(Component)]
struct ScoreText;

#[derive(Component)]
struct HpText;

#[derive(Resource)]
struct GameState { score: i32, hp: i32, spawn_timer: f32, distance: f32 }

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

pub fn setup(mut commands: Commands, pixar_assets: Res<PixarAssets>, custom_assets: Res<CustomAssets>) {
    commands.insert_resource(GameState { score: 0, hp: MAX_HP, spawn_timer: 0.0, distance: 0.0 });

    // Background
    let bg_sprite = if let Some(ref bg) = custom_assets.background {
        Sprite { image: bg.clone(), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() }
    } else {
        Sprite { color: palette::LAB_BG, custom_size: Some(Vec2::new(960.0, 640.0)), ..default() }
    };
    commands.spawn((bg_sprite, Transform::from_xyz(0.0, 0.0, -1.0), GameEntity));

    // Ground
    commands.spawn((
        Sprite { color: palette::GROUND_BROWN, custom_size: Some(Vec2::new(960.0, 40.0)), ..default() },
        Transform::from_xyz(0.0, GROUND_Y - 20.0, 0.0), GroundTile, GameEntity,
    ));

    // Player
    pixar::spawn_character(
        &mut commands,
        &pixar_assets,
        &CharacterConfig::hero(palette::HERO_GREEN, PLAYER_SIZE),
        Vec3::new(PLAYER_X, GROUND_Y + PLAYER_SIZE.y / 2.0, 1.0),
        (Player { vy: 0.0, on_ground: true }, GameEntity),
    );

    // HUD
    commands.spawn((
        Text::new("Score: 0"),
        TextFont { font_size: 22.0, ..default() },
        TextColor(Color::srgb(0.9, 0.85, 0.3)),
        Node { position_type: PositionType::Absolute, top: Val::Px(10.0), left: Val::Px(10.0), ..default() },
        ScoreText, GameEntity,
    ));
    commands.spawn((
        Text::new(format!("HP: {}", MAX_HP)),
        TextFont { font_size: 22.0, ..default() },
        TextColor(Color::srgb(1.0, 0.4, 0.4)),
        Node { position_type: PositionType::Absolute, top: Val::Px(10.0), right: Val::Px(10.0), ..default() },
        HpText, GameEntity,
    ));
}

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

pub fn player_input(
    keys: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
    touches: Res<Touches>,
    mut pq: Query<(&Transform, &mut Player)>,
    mut commands: Commands,
) {
    let Ok((tf, mut p)) = pq.get_single_mut() else { return };

    // Jump
    let jump = keys.just_pressed(KeyCode::Space)
        || keys.just_pressed(KeyCode::ArrowUp);
    if jump && p.on_ground {
        p.vy = JUMP_VEL;
        p.on_ground = false;
    }

    // Shoot
    let shoot = mouse.just_pressed(MouseButton::Left)
        || touches.any_just_pressed()
        || keys.just_pressed(KeyCode::KeyF);
    if shoot {
        commands.spawn((
            Sprite { color: palette::HERO_YELLOW, custom_size: Some(BULLET_SIZE), ..default() },
            Transform::from_xyz(tf.translation.x + 20.0, tf.translation.y, 0.5),
            Bullet, GameEntity,
        ));
    }
}

pub fn player_physics(time: Res<Time>, mut pq: Query<(&mut Transform, &mut Player)>) {
    let dt = time.delta_secs();
    for (mut tf, mut p) in &mut pq {
        p.vy += GRAVITY * dt;
        tf.translation.y += p.vy * dt;
        let floor = GROUND_Y + PLAYER_SIZE.y / 2.0;
        if tf.translation.y <= floor {
            tf.translation.y = floor;
            p.vy = 0.0;
            p.on_ground = true;
        }
    }
}

pub fn move_bullets(
    time: Res<Time>,
    mut commands: Commands,
    mut q: Query<(Entity, &mut Transform), With<Bullet>>,
) {
    let dt = time.delta_secs();
    for (e, mut tf) in &mut q {
        tf.translation.x += BULLET_SPEED * dt;
        if tf.translation.x > HALF_W + 30.0 { commands.entity(e).despawn(); }
    }
}

pub fn spawn_enemies(time: Res<Time>, mut state: ResMut<GameState>, mut commands: Commands, pixar_assets: Res<PixarAssets>) {
    state.spawn_timer += time.delta_secs();
    if state.spawn_timer < SPAWN_INTERVAL { return; }
    state.spawn_timer = 0.0;
    let mut rng = rand::thread_rng();
    let y = GROUND_Y + ENEMY_SIZE.y / 2.0 + rng.gen_range(0.0..80.0);
    pixar::spawn_character(
        &mut commands,
        &pixar_assets,
        &CharacterConfig::enemy(palette::VILLAIN_DARK, ENEMY_SIZE),
        Vec3::new(HALF_W + 30.0, y, 0.5),
        (Enemy, GameEntity),
    );
}

pub fn move_enemies(
    time: Res<Time>,
    mut commands: Commands,
    mut eq: Query<(Entity, &mut Transform), With<Enemy>>,
) {
    let dt = time.delta_secs();
    for (e, mut tf) in &mut eq {
        tf.translation.x -= ENEMY_SPEED * dt;
        if tf.translation.x < -HALF_W - 40.0 { commands.entity(e).despawn(); }
    }
}

pub fn check_collisions(
    mut commands: Commands,
    mut state: ResMut<GameState>,
    mut next_state: ResMut<NextState<crate::AppState>>,
    pq: Query<&Transform, With<Player>>,
    eq: Query<(Entity, &Transform), (With<Enemy>, Without<Bullet>)>,
    bq: Query<(Entity, &Transform), With<Bullet>>,
) {
    let Ok(ptf) = pq.get_single() else { return };

    // Bullet-enemy
    for (be, btf) in &bq {
        for (ee, etf) in &eq {
            let dx = (btf.translation.x - etf.translation.x).abs();
            let dy = (btf.translation.y - etf.translation.y).abs();
            if dx < (BULLET_SIZE.x + ENEMY_SIZE.x) / 2.0 && dy < (BULLET_SIZE.y + ENEMY_SIZE.y) / 2.0 {
                commands.entity(be).despawn();
                commands.entity(ee).despawn();
                state.score += 30;
                break;
            }
        }
    }

    // Enemy-player
    for (ee, etf) in &eq {
        let dx = (ptf.translation.x - etf.translation.x).abs();
        let dy = (ptf.translation.y - etf.translation.y).abs();
        if dx < (PLAYER_SIZE.x + ENEMY_SIZE.x) / 2.0 && dy < (PLAYER_SIZE.y + ENEMY_SIZE.y) / 2.0 {
            commands.entity(ee).despawn();
            state.hp -= 1;
            if state.hp <= 0 { next_state.set(crate::AppState::GameOver); return; }
        }
    }
}

pub fn advance_distance(time: Res<Time>, mut state: ResMut<GameState>) {
    state.distance += SCROLL_SPEED * time.delta_secs();
}

pub fn update_score(state: Res<GameState>, mut bridge: ResMut<BevyBridge>) {
    bridge.current_score = state.score;
}

pub fn update_hud(
    state: Res<GameState>,
    mut sq: Query<&mut Text, (With<ScoreText>, Without<HpText>)>,
    mut hq: Query<&mut Text, With<HpText>>,
) {
    for mut t in &mut sq { **t = format!("Score: {}", state.score); }
    for mut t in &mut hq { **t = format!("HP: {}", state.hp); }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

pub fn cleanup(mut commands: Commands, q: Query<Entity, With<GameEntity>>) {
    for e in &q { commands.entity(e).despawn(); }
    commands.remove_resource::<GameState>();
}
