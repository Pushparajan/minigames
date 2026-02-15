use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;
use crate::pixar::{self, PixarAssets, CharacterConfig, palette};
use crate::asset_loader::CustomAssets;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GROUND_Y: f32 = -270.0;
const PLAYER_SIZE: Vec2 = Vec2::new(28.0, 40.0);
const BULLET_SIZE: Vec2 = Vec2::new(8.0, 4.0);
const ENEMY_SIZE: Vec2 = Vec2::new(22.0, 22.0);
const MOVE_SPEED: f32 = 280.0;
const GRAVITY: f32 = -800.0;
const JET_THRUST: f32 = 1200.0;
const MAX_FUEL: f32 = 100.0;
const FUEL_DRAIN: f32 = 50.0;
const FUEL_REGEN: f32 = 40.0;
const BULLET_SPEED: f32 = 500.0;
const ENEMY_SPEED: f32 = 100.0;
const SPAWN_INTERVAL: f32 = 1.8;
const HALF_W: f32 = 480.0;
const HALF_H: f32 = 320.0;
const MAX_HP: i32 = 5;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

#[derive(Component)]
pub struct GameEntity;

#[derive(Component)]
struct Player { vy: f32, fuel: f32, on_ground: bool }

#[derive(Component)]
struct Enemy { time: f32, base_y: f32 }

#[derive(Component)]
struct Bullet { dx: f32, dy: f32 }

#[derive(Component)]
struct FuelBar;

#[derive(Component)]
struct ScoreText;

#[derive(Component)]
struct HpText;

#[derive(Resource)]
struct GameState { score: i32, hp: i32, spawn_timer: f32 }

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

pub fn setup(mut commands: Commands, pixar_assets: Res<PixarAssets>, custom_assets: Res<CustomAssets>) {
    commands.insert_resource(GameState { score: 0, hp: MAX_HP, spawn_timer: 0.0 });

    // Background
    let bg_sprite = if let Some(ref bg) = custom_assets.background {
        Sprite { image: bg.clone(), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() }
    } else {
        Sprite { color: palette::NIGHT_BG, custom_size: Some(Vec2::new(960.0, 640.0)), ..default() }
    };
    commands.spawn((bg_sprite, Transform::from_xyz(0.0, 0.0, -1.0), GameEntity));

    // Ground
    commands.spawn((
        Sprite { color: palette::GROUND_GREEN, custom_size: Some(Vec2::new(960.0, 50.0)), ..default() },
        Transform::from_xyz(0.0, GROUND_Y - 25.0, 0.0), GameEntity,
    ));

    // Player
    pixar::spawn_character(
        &mut commands,
        &pixar_assets,
        &CharacterConfig::vehicle(palette::HERO_TEAL, PLAYER_SIZE),
        Vec3::new(0.0, GROUND_Y + PLAYER_SIZE.y / 2.0, 1.0),
        (Player { vy: 0.0, fuel: MAX_FUEL, on_ground: true }, GameEntity),
    );

    // Fuel bar background
    commands.spawn((
        Sprite { color: Color::srgb(0.2, 0.2, 0.2), custom_size: Some(Vec2::new(104.0, 12.0)), ..default() },
        Transform::from_xyz(0.0, HALF_H - 30.0, 0.9), GameEntity,
    ));
    // Fuel bar fill
    commands.spawn((
        Sprite { color: palette::ELECTRIC_CYAN, custom_size: Some(Vec2::new(100.0, 8.0)), ..default() },
        Transform::from_xyz(0.0, HALF_H - 30.0, 1.0), FuelBar, GameEntity,
    ));

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
    time: Res<Time>,
    mut pq: Query<(&mut Transform, &mut Player)>,
    mut commands: Commands,
) {
    let dt = time.delta_secs();
    let Ok((mut tf, mut p)) = pq.get_single_mut() else { return };

    // Horizontal
    if keys.pressed(KeyCode::ArrowLeft) { tf.translation.x -= MOVE_SPEED * dt; }
    if keys.pressed(KeyCode::ArrowRight) { tf.translation.x += MOVE_SPEED * dt; }
    tf.translation.x = tf.translation.x.clamp(-HALF_W + 15.0, HALF_W - 15.0);

    // Jetpack
    let jetting = keys.pressed(KeyCode::Space);
    if jetting && p.fuel > 0.0 {
        p.vy += JET_THRUST * dt;
        p.fuel -= FUEL_DRAIN * dt;
        if p.fuel < 0.0 { p.fuel = 0.0; }
        p.on_ground = false;
    }

    // Gravity
    p.vy += GRAVITY * dt;
    tf.translation.y += p.vy * dt;

    let floor = GROUND_Y + PLAYER_SIZE.y / 2.0;
    if tf.translation.y <= floor {
        tf.translation.y = floor;
        p.vy = 0.0;
        p.on_ground = true;
        p.fuel = (p.fuel + FUEL_REGEN * dt).min(MAX_FUEL);
    }
    if tf.translation.y > HALF_H - 20.0 {
        tf.translation.y = HALF_H - 20.0;
        p.vy = 0.0;
    }

    // Shoot
    let shoot = mouse.just_pressed(MouseButton::Left) || touches.any_just_pressed()
        || keys.just_pressed(KeyCode::KeyF);
    if shoot {
        // Fire rightward by default (keyboard), or toward cursor could be added
        commands.spawn((
            Sprite { color: palette::ELECTRIC_CYAN, custom_size: Some(BULLET_SIZE), ..default() },
            Transform::from_xyz(tf.translation.x + 16.0, tf.translation.y, 0.5),
            Bullet { dx: BULLET_SPEED, dy: 0.0 }, GameEntity,
        ));
    }
}

pub fn move_bullets(
    time: Res<Time>,
    mut commands: Commands,
    mut q: Query<(Entity, &mut Transform, &Bullet)>,
) {
    let dt = time.delta_secs();
    for (e, mut tf, b) in &mut q {
        tf.translation.x += b.dx * dt;
        tf.translation.y += b.dy * dt;
        if tf.translation.x.abs() > HALF_W + 30.0 || tf.translation.y.abs() > HALF_H + 30.0 {
            commands.entity(e).despawn();
        }
    }
}

pub fn spawn_enemies(time: Res<Time>, mut state: ResMut<GameState>, mut commands: Commands, pixar_assets: Res<PixarAssets>) {
    state.spawn_timer += time.delta_secs();
    if state.spawn_timer < SPAWN_INTERVAL { return; }
    state.spawn_timer = 0.0;
    let mut rng = rand::thread_rng();
    let side = if rng.gen_bool(0.5) { HALF_W + 20.0 } else { -HALF_W - 20.0 };
    let y = rng.gen_range(GROUND_Y + 40.0..HALF_H - 40.0);
    pixar::spawn_character(
        &mut commands,
        &pixar_assets,
        &CharacterConfig::enemy(palette::VILLAIN_RED, ENEMY_SIZE),
        Vec3::new(side, y, 0.5),
        (Enemy { time: 0.0, base_y: y }, GameEntity),
    );
}

pub fn move_enemies(
    time: Res<Time>,
    pq: Query<&Transform, (With<Player>, Without<Enemy>)>,
    mut eq: Query<(&mut Transform, &mut Enemy)>,
) {
    let Ok(ptf) = pq.get_single() else { return };
    let dt = time.delta_secs();
    for (mut tf, mut e) in &mut eq {
        e.time += dt;
        let dx = ptf.translation.x - tf.translation.x;
        let dir = if dx > 0.0 { 1.0 } else { -1.0 };
        tf.translation.x += dir * ENEMY_SPEED * dt;
        // Sine-wave bobbing
        tf.translation.y = e.base_y + (e.time * 3.0).sin() * 30.0;
    }
}

pub fn check_collisions(
    mut commands: Commands,
    mut state: ResMut<GameState>,
    mut next_state: ResMut<NextState<crate::AppState>>,
    pq: Query<&Transform, With<Player>>,
    eq: Query<(Entity, &Transform), With<Enemy>>,
    bq: Query<(Entity, &Transform), With<Bullet>>,
) {
    let Ok(ptf) = pq.get_single() else { return };

    // Bullet-enemy
    for (be, btf) in &bq {
        for (ee, etf) in &eq {
            let dx = (btf.translation.x - etf.translation.x).abs();
            let dy = (btf.translation.y - etf.translation.y).abs();
            if dx < 15.0 && dy < 15.0 {
                commands.entity(be).despawn();
                commands.entity(ee).despawn();
                state.score += 50;
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

pub fn update_fuel_bar(
    pq: Query<&Player>,
    mut fq: Query<(&mut Sprite, &mut Transform), With<FuelBar>>,
) {
    let Ok(p) = pq.get_single() else { return };
    for (mut sp, mut tf) in &mut fq {
        let w = (p.fuel / MAX_FUEL) * 100.0;
        sp.custom_size = Some(Vec2::new(w, 8.0));
        tf.translation.x = -(100.0 - w) / 2.0;
    }
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
