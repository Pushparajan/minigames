use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;
use crate::pixar::{self, PixarAssets, CharacterConfig, palette};
use crate::asset_loader::CustomAssets;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COVER_POSITIONS: [f32; 3] = [-200.0, 0.0, 200.0];
const COVER_Y: f32 = -220.0;
const PLAYER_SIZE: Vec2 = Vec2::new(30.0, 40.0);
const ENEMY_SIZE: Vec2 = Vec2::new(28.0, 28.0);
const BULLET_SIZE: Vec2 = Vec2::new(6.0, 12.0);
const ENEMY_SPEED: f32 = 60.0;
const BULLET_SPEED: f32 = 500.0;
const SPAWN_INTERVAL: f32 = 1.8;
const ENEMY_SHOOT_INTERVAL: f32 = 2.0;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

#[derive(Component)]
pub struct GameEntity;

#[derive(Component)]
struct Player {
    cover_index: usize,
    exposed: bool,
    hp: i32,
    ammo: i32,
}

#[derive(Component)]
struct Enemy {
    hp: i32,
    shoot_timer: f32,
}

#[derive(Component)]
struct Bullet {
    friendly: bool,
    vy: f32,
}

#[derive(Component)]
struct CoverBlock;

#[derive(Component)]
struct HudText;

#[derive(Resource)]
struct GameState {
    score: i32,
    spawn_timer: f32,
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

pub fn setup(mut commands: Commands, pixar_assets: Res<PixarAssets>, custom_assets: Res<CustomAssets>) {
    commands.insert_resource(GameState { score: 0, spawn_timer: 0.0 });

    // Background
    if let Some(ref bg) = custom_assets.background {
        commands.spawn((
            Sprite { image: bg.clone(), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
            Transform::from_xyz(0.0, 0.0, -1.0), GameEntity,
        ));
    } else {
        commands.spawn((
            Sprite { color: palette::LAB_BG, custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
            Transform::from_xyz(0.0, 0.0, -1.0), GameEntity,
        ));
    }

    // Cover blocks
    for &cx in &COVER_POSITIONS {
        commands.spawn((
            Sprite { color: Color::srgb(0.35, 0.35, 0.4), custom_size: Some(Vec2::new(70.0, 50.0)), ..default() },
            Transform::from_xyz(cx, COVER_Y, 0.5), CoverBlock, GameEntity,
        ));
    }

    // Player
    pixar::spawn_character(
        &mut commands,
        &pixar_assets,
        &CharacterConfig::hero(palette::HERO_GREEN, PLAYER_SIZE),
        Vec3::new(COVER_POSITIONS[1], COVER_Y, 1.0),
        (Player { cover_index: 1, exposed: false, hp: 5, ammo: 15 }, GameEntity),
    );

    // HUD
    commands.spawn((
        Text::new("HP:5 Ammo:15 Score:0"),
        TextFont { font_size: 20.0, ..default() },
        TextColor(Color::srgb(0.9, 0.9, 0.3)),
        Node { position_type: PositionType::Absolute, top: Val::Px(10.0), left: Val::Px(10.0), ..default() },
        HudText, GameEntity,
    ));
}

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

pub fn player_input(
    keys: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
    pixar_assets: Res<PixarAssets>,
    mut player_q: Query<(&mut Player, &mut Transform)>,
    mut commands: Commands,
) {
    for (mut p, mut tf) in &mut player_q {
        if keys.just_pressed(KeyCode::ArrowLeft) || keys.just_pressed(KeyCode::KeyA) {
            if p.cover_index > 0 { p.cover_index -= 1; }
        }
        if keys.just_pressed(KeyCode::ArrowRight) || keys.just_pressed(KeyCode::KeyD) {
            if p.cover_index < 2 { p.cover_index += 1; }
        }
        p.exposed = keys.pressed(KeyCode::Space);
        tf.translation.x = COVER_POSITIONS[p.cover_index];
        tf.translation.y = if p.exposed { COVER_Y + 45.0 } else { COVER_Y };

        // Shoot
        if (mouse.just_pressed(MouseButton::Left) || keys.just_pressed(KeyCode::KeyF))
            && p.exposed && p.ammo > 0
        {
            p.ammo -= 1;
            commands.spawn((
                Sprite { color: palette::HERO_YELLOW, custom_size: Some(BULLET_SIZE), ..default() },
                Transform::from_xyz(tf.translation.x, tf.translation.y + 25.0, 2.0),
                Bullet { friendly: true, vy: BULLET_SPEED }, GameEntity,
            ));
        }

        // Reload
        if keys.just_pressed(KeyCode::KeyR) {
            p.ammo = (p.ammo + 5).min(20);
        }
    }
}

pub fn spawn_enemies(time: Res<Time>, mut state: ResMut<GameState>, pixar_assets: Res<PixarAssets>, mut commands: Commands) {
    state.spawn_timer += time.delta_secs();
    if state.spawn_timer >= SPAWN_INTERVAL {
        state.spawn_timer = 0.0;
        let mut rng = rand::thread_rng();
        let x = rng.gen_range(-300.0..300.0);
        pixar::spawn_character(
            &mut commands,
            &pixar_assets,
            &CharacterConfig::enemy(palette::VILLAIN_RED, ENEMY_SIZE),
            Vec3::new(x, 320.0, 1.0),
            (Enemy { hp: 1, shoot_timer: rng.gen_range(0.5..ENEMY_SHOOT_INTERVAL) }, GameEntity),
        );
    }
}

pub fn move_enemies(
    time: Res<Time>,
    player_q: Query<&Player>,
    mut enemy_q: Query<(&mut Transform, &mut Enemy)>,
    mut commands: Commands,
) {
    let dt = time.delta_secs();
    let exposed = player_q.get_single().map(|p| p.exposed).unwrap_or(false);
    for (mut tf, mut e) in &mut enemy_q {
        tf.translation.y -= ENEMY_SPEED * dt;
        if exposed {
            e.shoot_timer -= dt;
            if e.shoot_timer <= 0.0 {
                e.shoot_timer = ENEMY_SHOOT_INTERVAL;
                commands.spawn((
                    Sprite { color: palette::VILLAIN_RED, custom_size: Some(BULLET_SIZE), ..default() },
                    Transform::from_xyz(tf.translation.x, tf.translation.y - 15.0, 2.0),
                    Bullet { friendly: false, vy: -BULLET_SPEED * 0.6 }, GameEntity,
                ));
            }
        }
    }
}

pub fn move_bullets(time: Res<Time>, mut q: Query<(&mut Transform, &Bullet)>) {
    let dt = time.delta_secs();
    for (mut tf, b) in &mut q {
        tf.translation.y += b.vy * dt;
    }
}

pub fn bullet_collisions(
    mut commands: Commands,
    mut state: ResMut<GameState>,
    bullet_q: Query<(Entity, &Transform, &Bullet)>,
    mut enemy_q: Query<(Entity, &Transform, &mut Enemy)>,
    mut player_q: Query<&mut Player>,
) {
    for (be, btf, bullet) in &bullet_q {
        // Off-screen cleanup
        if btf.translation.y > 350.0 || btf.translation.y < -350.0 {
            commands.entity(be).despawn();
            continue;
        }
        if bullet.friendly {
            for (ee, etf, mut en) in &mut enemy_q {
                let dx = (btf.translation.x - etf.translation.x).abs();
                let dy = (btf.translation.y - etf.translation.y).abs();
                if dx < 20.0 && dy < 20.0 {
                    en.hp -= 1;
                    commands.entity(be).despawn();
                    if en.hp <= 0 {
                        commands.entity(ee).despawn();
                        state.score += 100;
                    }
                    break;
                }
            }
        } else if let Ok(mut p) = player_q.get_single_mut() {
            if p.exposed {
                let px = COVER_POSITIONS[p.cover_index];
                let py = COVER_Y + 45.0;
                let dx = (btf.translation.x - px).abs();
                let dy = (btf.translation.y - py).abs();
                if dx < 20.0 && dy < 25.0 {
                    p.hp -= 1;
                    commands.entity(be).despawn();
                }
            }
        }
    }
}

pub fn enemy_reach_bottom(
    mut commands: Commands,
    enemy_q: Query<(Entity, &Transform), With<Enemy>>,
    mut player_q: Query<&mut Player>,
) {
    for (e, tf) in &enemy_q {
        if tf.translation.y < COVER_Y - 30.0 {
            commands.entity(e).despawn();
            if let Ok(mut p) = player_q.get_single_mut() {
                p.hp -= 1;
            }
        }
    }
}

pub fn check_game_over(
    player_q: Query<&Player>,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    if let Ok(p) = player_q.get_single() {
        if p.hp <= 0 {
            next_state.set(crate::AppState::GameOver);
        }
    }
}

pub fn update_score(state: Res<GameState>, mut bridge: ResMut<BevyBridge>) {
    bridge.current_score = state.score;
}

pub fn update_hud(
    player_q: Query<&Player>,
    state: Res<GameState>,
    mut q: Query<&mut Text, With<HudText>>,
) {
    if let Ok(p) = player_q.get_single() {
        for mut t in &mut q {
            **t = format!("HP:{} Ammo:{} Score:{}", p.hp, p.ammo, state.score);
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
