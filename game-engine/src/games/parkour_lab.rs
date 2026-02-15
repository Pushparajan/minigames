use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;
use crate::pixar::{self, PixarAssets, CharacterConfig, palette};
use crate::asset_loader::CustomAssets;

// Constants
const GROUND_Y: f32 = -250.0;
const PLAYER_X: f32 = -200.0;
const PLAYER_W: f32 = 26.0;
const PLAYER_H_RUN: f32 = 48.0;
const PLAYER_H_SLIDE: f32 = 24.0;
const GRAVITY: f32 = -1400.0;
const JUMP_VEL: f32 = 620.0;
const BASE_SPEED: f32 = 250.0;
const MOMENTUM_BOOST: f32 = 0.1;
const MAX_MOMENTUM: f32 = 3.0;
const MOMENTUM_LOSS: f32 = 0.4;
const OBSTACLE_GAP: f32 = 350.0;
const HALF_W: f32 = 480.0;
const WALL_SIZE: Vec2 = Vec2::new(30.0, 60.0);
const BAR_SIZE: Vec2 = Vec2::new(60.0, 14.0);
const BAR_Y: f32 = GROUND_Y + 60.0;
const GAP_WIDTH: f32 = 80.0;

// Components
#[derive(Component)]
pub struct GameEntity;

#[derive(Clone, Copy, PartialEq)]
enum PlayerState { Running, Jumping, Sliding }

#[derive(Component)]
struct Player { vy: f32, state: PlayerState, momentum: f32, slide_timer: f32 }

#[derive(Clone, Copy, PartialEq)]
enum ObstacleKind { Wall, Bar, Gap }

#[derive(Component)]
struct Obstacle { kind: ObstacleKind, scored: bool }

#[derive(Component)]
struct ScoreText;

#[derive(Component)]
struct MomentumText;

#[derive(Resource)]
struct GameState { distance: f32, spawn_timer: f32, score: i32 }

// Setup
pub fn setup(mut commands: Commands, pixar_assets: Res<PixarAssets>, custom_assets: Res<CustomAssets>) {
    commands.insert_resource(GameState { distance: 0.0, spawn_timer: 0.0, score: 0 });

    let bg_sprite = if let Some(ref bg) = custom_assets.background {
        Sprite { image: bg.clone(), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() }
    } else {
        Sprite { color: palette::NIGHT_BG, custom_size: Some(Vec2::new(960.0, 640.0)), ..default() }
    };
    commands.spawn((bg_sprite, Transform::from_xyz(0.0, 0.0, -1.0), GameEntity));
    commands.spawn((
        Sprite { color: palette::GROUND_GREEN, custom_size: Some(Vec2::new(960.0, 40.0)), ..default() },
        Transform::from_xyz(0.0, GROUND_Y - 20.0, 0.0), GameEntity,
    ));
    pixar::spawn_character(
        &mut commands,
        &pixar_assets,
        &CharacterConfig::hero(palette::HERO_ORANGE, Vec2::new(PLAYER_W, PLAYER_H_RUN)),
        Vec3::new(PLAYER_X, GROUND_Y + PLAYER_H_RUN / 2.0, 1.0),
        (Player { vy: 0.0, state: PlayerState::Running, momentum: 1.0, slide_timer: 0.0 }, GameEntity),
    );
    commands.spawn((
        Text::new("Score: 0"),
        TextFont { font_size: 22.0, ..default() },
        TextColor(Color::srgb(0.9, 0.85, 0.3)),
        Node { position_type: PositionType::Absolute, top: Val::Px(10.0), left: Val::Px(10.0), ..default() },
        ScoreText, GameEntity,
    ));
    commands.spawn((
        Text::new("Momentum: 1.0x"),
        TextFont { font_size: 20.0, ..default() },
        TextColor(Color::srgb(0.5, 0.9, 1.0)),
        Node { position_type: PositionType::Absolute, top: Val::Px(10.0), right: Val::Px(10.0), ..default() },
        MomentumText, GameEntity,
    ));
    spawn_obstacle(&mut commands, &pixar_assets, 400.0);
    spawn_obstacle(&mut commands, &pixar_assets, 750.0);
}

// Systems
pub fn player_input(
    keys: Res<ButtonInput<KeyCode>>, mouse: Res<ButtonInput<MouseButton>>,
    touches: Res<Touches>, mut pq: Query<(&mut Player, &mut Sprite, &mut Transform)>,
) {
    let jump = keys.just_pressed(KeyCode::Space) || keys.just_pressed(KeyCode::ArrowUp)
        || mouse.just_pressed(MouseButton::Left) || touches.any_just_pressed();
    let slide = keys.pressed(KeyCode::ArrowDown);
    for (mut p, mut sp, mut tf) in &mut pq {
        match p.state {
            PlayerState::Running => {
                if jump {
                    p.vy = JUMP_VEL;
                    p.state = PlayerState::Jumping;
                } else if slide {
                    p.state = PlayerState::Sliding;
                    p.slide_timer = 0.5;
                    sp.custom_size = Some(Vec2::new(PLAYER_W, PLAYER_H_SLIDE));
                    tf.translation.y = GROUND_Y + PLAYER_H_SLIDE / 2.0;
                }
            }
            PlayerState::Jumping => {}
            PlayerState::Sliding => {
                if jump {
                    p.state = PlayerState::Jumping;
                    p.vy = JUMP_VEL;
                    sp.custom_size = Some(Vec2::new(PLAYER_W, PLAYER_H_RUN));
                    tf.translation.y = GROUND_Y + PLAYER_H_RUN / 2.0;
                }
            }
        }
    }
}

pub fn player_physics(time: Res<Time>, mut pq: Query<(&mut Transform, &mut Player, &mut Sprite)>) {
    let dt = time.delta_secs();
    for (mut tf, mut p, mut sp) in &mut pq {
        match p.state {
            PlayerState::Jumping => {
                p.vy += GRAVITY * dt;
                tf.translation.y += p.vy * dt;
                let floor = GROUND_Y + PLAYER_H_RUN / 2.0;
                if tf.translation.y <= floor {
                    tf.translation.y = floor;
                    p.vy = 0.0;
                    p.state = PlayerState::Running;
                }
            }
            PlayerState::Sliding => {
                p.slide_timer -= dt;
                if p.slide_timer <= 0.0 {
                    p.state = PlayerState::Running;
                    sp.custom_size = Some(Vec2::new(PLAYER_W, PLAYER_H_RUN));
                    tf.translation.y = GROUND_Y + PLAYER_H_RUN / 2.0;
                }
            }
            PlayerState::Running => {}
        }
    }
}

pub fn scroll_world(
    time: Res<Time>, mut state: ResMut<GameState>, pq: Query<&Player>,
    mut oq: Query<&mut Transform, With<Obstacle>>,
    entities: Query<Entity, With<Obstacle>>, mut commands: Commands,
) {
    let Ok(player) = pq.get_single() else { return };
    let dt = time.delta_secs();
    let scroll = BASE_SPEED * player.momentum * dt;
    state.distance += scroll;
    for mut tf in &mut oq { tf.translation.x -= scroll; }
    for (entity, tf) in entities.iter().zip(oq.iter()) {
        if tf.translation.x < -HALF_W - 60.0 { commands.entity(entity).despawn(); }
    }
}

pub fn spawn_obstacles(time: Res<Time>, mut state: ResMut<GameState>, pq: Query<&Player>, mut commands: Commands, pixar_assets: Res<PixarAssets>) {
    let Ok(player) = pq.get_single() else { return };
    state.spawn_timer += BASE_SPEED * player.momentum * time.delta_secs();
    if state.spawn_timer >= OBSTACLE_GAP {
        state.spawn_timer = 0.0;
        spawn_obstacle(&mut commands, &pixar_assets, HALF_W + 60.0);
    }
}

pub fn check_collisions(
    pq: Query<(&Transform, &Player, &Sprite), Without<Obstacle>>,
    mut oq: Query<(&Transform, &Sprite, &mut Obstacle)>,
    mut player_q: Query<&mut Player>,
    mut state: ResMut<GameState>,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    let Ok((ptf, player, psp)) = pq.get_single() else { return };
    let ph = psp.custom_size.unwrap_or(Vec2::new(PLAYER_W, PLAYER_H_RUN));
    let phalf = ph / 2.0;
    for (otf, osp, mut obs) in &mut oq {
        let ohalf = osp.custom_size.unwrap_or(Vec2::splat(30.0)) / 2.0;
        let dx = (ptf.translation.x - otf.translation.x).abs();
        let dy = (ptf.translation.y - otf.translation.y).abs();
        let ox = dx < phalf.x + ohalf.x;
        let oy = dy < phalf.y + ohalf.y;
        match obs.kind {
            ObstacleKind::Gap => {
                if ox && ptf.translation.y - phalf.y <= GROUND_Y + 5.0 && player.state != PlayerState::Jumping {
                    next_state.set(crate::AppState::GameOver); return;
                }
                if ox && !obs.scored && player.state == PlayerState::Jumping {
                    obs.scored = true;
                    if let Ok(mut p) = player_q.get_single_mut() { p.momentum = (p.momentum + MOMENTUM_BOOST).min(MAX_MOMENTUM); }
                    state.score += 10;
                }
            }
            ObstacleKind::Wall => {
                if ox && oy {
                    if let Ok(mut p) = player_q.get_single_mut() { p.momentum = (p.momentum - MOMENTUM_LOSS).max(0.5); }
                    if !obs.scored { obs.scored = true; state.score = (state.score - 5).max(0); }
                } else if ox && !obs.scored && player.state == PlayerState::Jumping {
                    obs.scored = true;
                    if let Ok(mut p) = player_q.get_single_mut() { p.momentum = (p.momentum + MOMENTUM_BOOST).min(MAX_MOMENTUM); }
                    state.score += 10;
                }
            }
            ObstacleKind::Bar => {
                if ox && oy {
                    if let Ok(mut p) = player_q.get_single_mut() { p.momentum = (p.momentum - MOMENTUM_LOSS).max(0.5); }
                    if !obs.scored { obs.scored = true; state.score = (state.score - 5).max(0); }
                } else if ox && !obs.scored && player.state == PlayerState::Sliding {
                    obs.scored = true;
                    if let Ok(mut p) = player_q.get_single_mut() { p.momentum = (p.momentum + MOMENTUM_BOOST).min(MAX_MOMENTUM); }
                    state.score += 10;
                }
            }
        }
    }
}

pub fn update_score(state: Res<GameState>, pq: Query<&Player>, mut bridge: ResMut<BevyBridge>) {
    let Ok(_p) = pq.get_single() else { return };
    bridge.current_score = state.score + (state.distance / 10.0) as i32;
}

pub fn update_hud(
    state: Res<GameState>, pq: Query<&Player>,
    mut sq: Query<&mut Text, (With<ScoreText>, Without<MomentumText>)>,
    mut mq: Query<&mut Text, With<MomentumText>>,
) {
    let Ok(p) = pq.get_single() else { return };
    let total = state.score + (state.distance / 10.0) as i32;
    for mut t in &mut sq { **t = format!("Score: {}", total); }
    for mut t in &mut mq { **t = format!("Momentum: {:.1}x", p.momentum); }
}

// Cleanup
pub fn cleanup(mut commands: Commands, q: Query<Entity, With<GameEntity>>) {
    for e in &q { commands.entity(e).despawn(); }
    commands.remove_resource::<GameState>();
}

// Helpers
fn spawn_obstacle(commands: &mut Commands, pixar_assets: &PixarAssets, x: f32) {
    let mut rng = rand::thread_rng();
    match rng.gen_range(0..3) {
        0 => { commands.spawn((
            pixar::round_sprite(pixar_assets, palette::VILLAIN_RED, WALL_SIZE),
            Transform::from_xyz(x, GROUND_Y + WALL_SIZE.y / 2.0, 0.5),
            Obstacle { kind: ObstacleKind::Wall, scored: false }, GameEntity,
        )); }
        1 => { commands.spawn((
            pixar::round_sprite(pixar_assets, palette::VILLAIN_PURPLE, BAR_SIZE),
            Transform::from_xyz(x, BAR_Y, 0.5),
            Obstacle { kind: ObstacleKind::Bar, scored: false }, GameEntity,
        )); }
        _ => { commands.spawn((
            Sprite { color: palette::NIGHT_BG, custom_size: Some(Vec2::new(GAP_WIDTH, 40.0)), ..default() },
            Transform::from_xyz(x, GROUND_Y - 20.0, 0.5),
            Obstacle { kind: ObstacleKind::Gap, scored: false }, GameEntity,
        )); }
    }
}
