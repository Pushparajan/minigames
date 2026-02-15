use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;
use crate::pixar::{self, PixarAssets, CharacterConfig, palette};
use crate::asset_loader::CustomAssets;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAYER_SIZE: Vec2 = Vec2::new(30.0, 30.0);
const BULLET_SIZE: Vec2 = Vec2::new(6.0, 6.0);
const ENEMY_SIZE: Vec2 = Vec2::new(24.0, 24.0);
const PLAYER_ROTATE_SPEED: f32 = 4.0;
const PLAYER_THRUST: f32 = 400.0;
const PLAYER_DRAG: f32 = 0.98;
const BULLET_SPEED: f32 = 500.0;
const ENEMY_SPEED: f32 = 120.0;
const SPAWN_INTERVAL: f32 = 1.5;
const HALF_W: f32 = 480.0;
const HALF_H: f32 = 320.0;
const MAX_HP: i32 = 5;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

#[derive(Component)]
pub struct GameEntity;

#[derive(Component)]
struct Player {
    vx: f32,
    vy: f32,
}

#[derive(Component)]
struct Enemy;

#[derive(Component)]
struct Bullet {
    dx: f32,
    dy: f32,
}

#[derive(Component)]
struct ScoreText;

#[derive(Component)]
struct HpText;

#[derive(Resource)]
struct GameState {
    score: i32,
    hp: i32,
    spawn_timer: f32,
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

pub fn setup(mut commands: Commands, pixar_assets: Res<PixarAssets>, custom_assets: Res<CustomAssets>) {
    commands.insert_resource(GameState {
        score: 0,
        hp: MAX_HP,
        spawn_timer: 0.0,
    });

    // Background
    let bg_sprite = if let Some(ref bg) = custom_assets.background {
        Sprite { image: bg.clone(), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() }
    } else {
        Sprite { color: palette::NIGHT_BG, custom_size: Some(Vec2::new(960.0, 640.0)), ..default() }
    };
    commands.spawn((bg_sprite, Transform::from_xyz(0.0, 0.0, -1.0), GameEntity));

    // Player
    pixar::spawn_character(
        &mut commands,
        &pixar_assets,
        &CharacterConfig::vehicle(palette::HERO_TEAL, PLAYER_SIZE),
        Vec3::new(0.0, 0.0, 1.0),
        (Player { vx: 0.0, vy: 0.0 }, GameEntity),
    );

    // HUD - Score
    commands.spawn((
        Text::new("Score: 0"),
        TextFont { font_size: 22.0, ..default() },
        TextColor(Color::srgb(0.9, 0.85, 0.3)),
        Node { position_type: PositionType::Absolute, top: Val::Px(10.0), left: Val::Px(10.0), ..default() },
        ScoreText,
        GameEntity,
    ));

    // HUD - HP
    commands.spawn((
        Text::new(format!("HP: {}", MAX_HP)),
        TextFont { font_size: 22.0, ..default() },
        TextColor(Color::srgb(1.0, 0.4, 0.4)),
        Node { position_type: PositionType::Absolute, top: Val::Px(10.0), right: Val::Px(10.0), ..default() },
        HpText,
        GameEntity,
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
    let Ok((mut tf, mut player)) = pq.get_single_mut() else { return };

    if keys.pressed(KeyCode::ArrowLeft) {
        tf.rotate_z(PLAYER_ROTATE_SPEED * dt);
    }
    if keys.pressed(KeyCode::ArrowRight) {
        tf.rotate_z(-PLAYER_ROTATE_SPEED * dt);
    }

    let angle = tf.rotation.to_euler(EulerRot::XYZ).2;

    if keys.pressed(KeyCode::ArrowUp) {
        player.vx += angle.cos() * PLAYER_THRUST * dt;
        player.vy += angle.sin() * PLAYER_THRUST * dt;
    }

    // Drag
    player.vx *= PLAYER_DRAG;
    player.vy *= PLAYER_DRAG;
    tf.translation.x += player.vx * dt;
    tf.translation.y += player.vy * dt;

    // Wrap around
    if tf.translation.x > HALF_W { tf.translation.x = -HALF_W; }
    if tf.translation.x < -HALF_W { tf.translation.x = HALF_W; }
    if tf.translation.y > HALF_H { tf.translation.y = -HALF_H; }
    if tf.translation.y < -HALF_H { tf.translation.y = HALF_H; }

    // Shoot
    let shoot = keys.just_pressed(KeyCode::Space)
        || mouse.just_pressed(MouseButton::Left)
        || touches.any_just_pressed();

    if shoot {
        let dir_x = (angle + std::f32::consts::FRAC_PI_2).sin();
        let dir_y = (angle + std::f32::consts::FRAC_PI_2).cos();
        commands.spawn((
            Sprite { color: palette::HERO_YELLOW, custom_size: Some(BULLET_SIZE), ..default() },
            Transform::from_xyz(tf.translation.x, tf.translation.y, 0.5),
            Bullet { dx: dir_x * BULLET_SPEED, dy: dir_y * BULLET_SPEED },
            GameEntity,
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
        if tf.translation.x.abs() > HALF_W + 50.0 || tf.translation.y.abs() > HALF_H + 50.0 {
            commands.entity(e).despawn();
        }
    }
}

pub fn spawn_enemies(time: Res<Time>, mut state: ResMut<GameState>, mut commands: Commands, pixar_assets: Res<PixarAssets>) {
    state.spawn_timer += time.delta_secs();
    if state.spawn_timer < SPAWN_INTERVAL { return; }
    state.spawn_timer = 0.0;
    let mut rng = rand::thread_rng();
    let (x, y) = match rng.gen_range(0..4) {
        0 => (rng.gen_range(-HALF_W..HALF_W), HALF_H + 20.0),
        1 => (rng.gen_range(-HALF_W..HALF_W), -HALF_H - 20.0),
        2 => (-HALF_W - 20.0, rng.gen_range(-HALF_H..HALF_H)),
        _ => (HALF_W + 20.0, rng.gen_range(-HALF_H..HALF_H)),
    };
    pixar::spawn_character(
        &mut commands,
        &pixar_assets,
        &CharacterConfig::enemy(palette::VILLAIN_RED, ENEMY_SIZE),
        Vec3::new(x, y, 0.5),
        (Enemy, GameEntity),
    );
}

pub fn move_enemies(
    time: Res<Time>,
    pq: Query<&Transform, (With<Player>, Without<Enemy>)>,
    mut eq: Query<&mut Transform, With<Enemy>>,
) {
    let Ok(ptf) = pq.get_single() else { return };
    let dt = time.delta_secs();
    for mut tf in &mut eq {
        let dx = ptf.translation.x - tf.translation.x;
        let dy = ptf.translation.y - tf.translation.y;
        let len = (dx * dx + dy * dy).sqrt().max(1.0);
        tf.translation.x += (dx / len) * ENEMY_SPEED * dt;
        tf.translation.y += (dy / len) * ENEMY_SPEED * dt;
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
            if dx < (BULLET_SIZE.x + ENEMY_SIZE.x) / 2.0 && dy < (BULLET_SIZE.y + ENEMY_SIZE.y) / 2.0 {
                commands.entity(be).despawn();
                commands.entity(ee).despawn();
                state.score += 50;
                break;
            }
        }
    }

    // Enemy-player
    for (_ee, etf) in &eq {
        let dx = (ptf.translation.x - etf.translation.x).abs();
        let dy = (ptf.translation.y - etf.translation.y).abs();
        if dx < (PLAYER_SIZE.x + ENEMY_SIZE.x) / 2.0 && dy < (PLAYER_SIZE.y + ENEMY_SIZE.y) / 2.0 {
            state.hp -= 1;
            commands.entity(_ee).despawn();
            if state.hp <= 0 {
                next_state.set(crate::AppState::GameOver);
                return;
            }
        }
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
