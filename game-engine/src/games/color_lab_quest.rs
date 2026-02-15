use bevy::prelude::*;

use crate::BevyBridge;
use crate::pixar::{self, PixarAssets, CharacterConfig, palette};
use crate::asset_loader::CustomAssets;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRAVITY: f32 = -900.0;
const JUMP_VEL: f32 = 450.0;
const MOVE_SPEED: f32 = 250.0;
const PLAYER_SIZE: Vec2 = Vec2::new(28.0, 36.0);
const PLAT_H: f32 = 16.0;
const ORB_SIZE: f32 = 18.0;
const HALF_W: f32 = 480.0;
const HALF_H: f32 = 320.0;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

#[derive(Component)]
pub struct GameEntity;

#[derive(Clone, Copy, PartialEq, Eq)]
enum GameColor { Red, Green, Blue }

#[derive(Component)]
struct Player {
    vy: f32,
    on_ground: bool,
    active: GameColor,
}

#[derive(Component)]
struct Platform {
    color: GameColor,
}

#[derive(Component)]
struct Orb {
    color: GameColor,
}

#[derive(Component)]
struct Goal;

#[derive(Component)]
struct ScoreText;

#[derive(Resource)]
struct GameState {
    score: i32,
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

pub fn setup(mut commands: Commands, pixar_assets: Res<PixarAssets>, custom_assets: Res<CustomAssets>) {
    commands.insert_resource(GameState { score: 0 });

    // Background
    if let Some(ref bg_handle) = custom_assets.background {
        commands.spawn((
            Sprite { image: bg_handle.clone(), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
            Transform::from_xyz(0.0, 0.0, -1.0),
            GameEntity,
        ));
    } else {
        commands.spawn((
            Sprite { color: Color::srgb(0.06, 0.04, 0.12), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
            Transform::from_xyz(0.0, 0.0, -1.0),
            GameEntity,
        ));
    }

    // Ground (always solid, white) — prop
    let ground_size = Vec2::new(960.0, 20.0);
    let ground_config = CharacterConfig::prop(Color::srgb(0.3, 0.3, 0.3), ground_size, false);
    pixar::spawn_character(
        &mut commands,
        &pixar_assets,
        &ground_config,
        Vec3::new(0.0, -HALF_H + 10.0, 0.0),
        (Platform { color: GameColor::Red }, GameEntity),
    );

    // Platforms
    let plats: Vec<(f32, f32, f32, GameColor)> = vec![
        (-300.0, -180.0, 140.0, GameColor::Red),
        (-100.0, -100.0, 120.0, GameColor::Blue),
        (80.0,   -20.0,  130.0, GameColor::Green),
        (-200.0,  60.0,  110.0, GameColor::Red),
        (0.0,    140.0,  150.0, GameColor::Blue),
        (250.0,   60.0,  100.0, GameColor::Green),
        (200.0,  200.0,  120.0, GameColor::Red),
        (-50.0,  260.0,  130.0, GameColor::Green),
        (350.0,  270.0,   80.0, GameColor::Blue),
    ];
    for (x, y, w, c) in &plats {
        let plat_size = Vec2::new(*w, PLAT_H);
        let plat_config = CharacterConfig::prop(gc_color(*c), plat_size, false);
        pixar::spawn_character(
            &mut commands,
            &pixar_assets,
            &plat_config,
            Vec3::new(*x, *y, 0.0),
            (Platform { color: *c }, GameEntity),
        );
    }

    // Orbs — collectibles with faces
    let orbs: Vec<(f32, f32, GameColor)> = vec![
        (-300.0, -150.0, GameColor::Red),
        (-100.0, -70.0,  GameColor::Blue),
        (80.0,   10.0,   GameColor::Green),
        (250.0,  90.0,   GameColor::Green),
        (0.0,    170.0,  GameColor::Blue),
    ];
    for (x, y, c) in &orbs {
        let orb_color = gc_bright(*c);
        let config = CharacterConfig::collectible(orb_color, ORB_SIZE);
        pixar::spawn_character(
            &mut commands,
            &pixar_assets,
            &config,
            Vec3::new(*x, *y, 0.5),
            (Orb { color: *c }, GameEntity),
        );
    }

    // Goal star — collectible with GOLD
    let goal_config = CharacterConfig::collectible(palette::GOLD, 30.0);
    pixar::spawn_character(
        &mut commands,
        &pixar_assets,
        &goal_config,
        Vec3::new(350.0, 300.0, 0.5),
        (Goal, GameEntity),
    );

    // Player — hero with HERO_PURPLE
    let player_config = CharacterConfig::hero(palette::HERO_PURPLE, PLAYER_SIZE);
    pixar::spawn_character(
        &mut commands,
        &pixar_assets,
        &player_config,
        Vec3::new(-400.0, -HALF_H + 20.0 + PLAYER_SIZE.y / 2.0, 1.0),
        (Player { vy: 0.0, on_ground: true, active: GameColor::Red }, GameEntity),
    );

    // HUD
    commands.spawn((
        Text::new("Score: 0 | Color: RED"),
        TextFont { font_size: 22.0, ..default() },
        TextColor(Color::srgb(0.9, 0.85, 0.3)),
        Node { position_type: PositionType::Absolute, top: Val::Px(10.0), left: Val::Px(10.0), ..default() },
        ScoreText,
        GameEntity,
    ));
}

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

pub fn player_input(
    keys: Res<ButtonInput<KeyCode>>,
    time: Res<Time>,
    mut pq: Query<(&mut Transform, &mut Player)>,
) {
    let dt = time.delta_secs();
    let Ok((mut tf, mut player)) = pq.get_single_mut() else { return };

    // Color switch
    if keys.just_pressed(KeyCode::Digit1) { player.active = GameColor::Red; }
    if keys.just_pressed(KeyCode::Digit2) { player.active = GameColor::Blue; }
    if keys.just_pressed(KeyCode::Digit3) { player.active = GameColor::Green; }

    // Horizontal
    if keys.pressed(KeyCode::ArrowLeft) { tf.translation.x -= MOVE_SPEED * dt; }
    if keys.pressed(KeyCode::ArrowRight) { tf.translation.x += MOVE_SPEED * dt; }
    tf.translation.x = tf.translation.x.clamp(-HALF_W + PLAYER_SIZE.x / 2.0, HALF_W - PLAYER_SIZE.x / 2.0);

    // Jump
    if keys.just_pressed(KeyCode::ArrowUp) && player.on_ground {
        player.vy = JUMP_VEL;
        player.on_ground = false;
    }
}

pub fn physics(
    time: Res<Time>,
    mut pq: Query<(&mut Transform, &mut Player)>,
    plats: Query<(&Transform, &Platform, &Sprite), Without<Player>>,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    let dt = time.delta_secs();
    let Ok((mut tf, mut player)) = pq.get_single_mut() else { return };

    player.vy += GRAVITY * dt;
    tf.translation.y += player.vy * dt;
    player.on_ground = false;

    // Check platform collisions (only matching color or ground)
    let foot = tf.translation.y - PLAYER_SIZE.y / 2.0;
    for (ptf, plat, spr) in &plats {
        // Ground is always solid; colored platforms only if matching
        let is_ground = ptf.translation.y < -HALF_H + 15.0;
        if !is_ground && plat.color != player.active { continue; }

        let pw = spr.custom_size.map(|s| s.x).unwrap_or(100.0) / 2.0;
        let ph = spr.custom_size.map(|s| s.y).unwrap_or(16.0) / 2.0;
        let plat_top = ptf.translation.y + ph;
        let plat_bot = ptf.translation.y - ph;

        let overlap_x = (tf.translation.x - ptf.translation.x).abs() < pw + PLAYER_SIZE.x / 2.0;
        if overlap_x && player.vy <= 0.0 && foot <= plat_top && foot >= plat_bot - 10.0 {
            tf.translation.y = plat_top + PLAYER_SIZE.y / 2.0;
            player.vy = 0.0;
            player.on_ground = true;
        }
    }

    // Fall off screen
    if tf.translation.y < -HALF_H - 50.0 {
        next_state.set(crate::AppState::GameOver);
    }
}

pub fn collect_orbs(
    mut commands: Commands,
    mut state: ResMut<GameState>,
    pq: Query<(&Transform, &Player)>,
    orbs: Query<(Entity, &Transform, &Orb)>,
) {
    let Ok((ptf, player)) = pq.get_single() else { return };
    for (e, otf, orb) in &orbs {
        let dx = (ptf.translation.x - otf.translation.x).abs();
        let dy = (ptf.translation.y - otf.translation.y).abs();
        if dx < 24.0 && dy < 24.0 && orb.color == player.active {
            state.score += 100;
            commands.entity(e).despawn_recursive();
        }
    }
}

pub fn check_goal(
    pq: Query<&Transform, With<Player>>,
    gq: Query<&Transform, With<Goal>>,
    mut state: ResMut<GameState>,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    let Ok(ptf) = pq.get_single() else { return };
    for gtf in &gq {
        let dx = (ptf.translation.x - gtf.translation.x).abs();
        let dy = (ptf.translation.y - gtf.translation.y).abs();
        if dx < 30.0 && dy < 30.0 {
            state.score += 500;
            next_state.set(crate::AppState::GameOver);
        }
    }
}

pub fn update_platform_vis(
    pq: Query<&Player>,
    mut plats: Query<(&Platform, &mut Sprite), Without<Player>>,
) {
    let Ok(player) = pq.get_single() else { return };
    for (plat, mut spr) in &mut plats {
        if plat.color == player.active {
            spr.color = gc_color(plat.color);
        } else {
            spr.color = gc_color(plat.color).with_alpha(0.2);
        }
    }
}

pub fn update_score(state: Res<GameState>, mut bridge: ResMut<BevyBridge>) {
    bridge.current_score = state.score;
}

pub fn update_hud(state: Res<GameState>, pq: Query<&Player>, mut sq: Query<&mut Text, With<ScoreText>>) {
    let Ok(player) = pq.get_single() else { return };
    let cn = match player.active { GameColor::Red => "RED", GameColor::Blue => "BLUE", GameColor::Green => "GREEN" };
    for mut t in &mut sq { **t = format!("Score: {} | Color: {}", state.score, cn); }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

pub fn cleanup(mut commands: Commands, q: Query<Entity, With<GameEntity>>) {
    for e in &q { commands.entity(e).despawn_recursive(); }
    commands.remove_resource::<GameState>();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn gc_color(c: GameColor) -> Color {
    match c {
        GameColor::Red => Color::srgb(0.85, 0.2, 0.2),
        GameColor::Green => Color::srgb(0.2, 0.8, 0.2),
        GameColor::Blue => Color::srgb(0.2, 0.3, 0.9),
    }
}

fn gc_bright(c: GameColor) -> Color {
    match c {
        GameColor::Red => Color::srgb(1.0, 0.4, 0.4),
        GameColor::Green => Color::srgb(0.4, 1.0, 0.4),
        GameColor::Blue => Color::srgb(0.4, 0.5, 1.0),
    }
}
