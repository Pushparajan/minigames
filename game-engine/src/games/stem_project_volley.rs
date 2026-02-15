use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRAVITY: f32 = 250.0;
const PLAYER_X: f32 = -320.0;
const ENEMY_X: f32 = 320.0;
const PLATFORM_Y: f32 = -150.0;
const CHAR_SIZE: Vec2 = Vec2::new(30.0, 40.0);
const BLOCK_SIZE: Vec2 = Vec2::new(36.0, 36.0);
const PROJ_SIZE: Vec2 = Vec2::new(10.0, 10.0);
const MAX_POWER: f32 = 400.0;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

#[derive(Component)]
pub struct GameEntity;

#[derive(Component)]
struct Player { hp: i32 }

#[derive(Component)]
struct EnemyAI { hp: i32 }

#[derive(Component)]
struct Projectile { vx: f32, vy: f32, friendly: bool }

#[derive(Component)]
struct Platform { destructible: bool, hp: i32 }

#[derive(Component)]
struct HudText;

#[derive(Resource)]
struct GameState {
    score: i32,
    player_turn: bool,
    dragging: bool,
    drag_start: Vec2,
    turn_timer: f32,
    fired: bool,
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

pub fn setup(mut commands: Commands) {
    commands.insert_resource(GameState {
        score: 0, player_turn: true, dragging: false,
        drag_start: Vec2::ZERO, turn_timer: 0.0, fired: false,
    });

    // Background
    commands.spawn((
        Sprite { color: Color::srgb(0.06, 0.06, 0.14), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
        Transform::from_xyz(0.0, 0.0, -1.0), GameEntity,
    ));

    // Player platform + character
    commands.spawn((
        Sprite { color: Color::srgb(0.3, 0.3, 0.35), custom_size: Some(Vec2::new(80.0, 20.0)), ..default() },
        Transform::from_xyz(PLAYER_X, PLATFORM_Y, 0.0), GameEntity,
    ));
    commands.spawn((
        Sprite { color: Color::srgb(0.3, 0.6, 0.9), custom_size: Some(CHAR_SIZE), ..default() },
        Transform::from_xyz(PLAYER_X, PLATFORM_Y + 30.0, 1.0),
        Player { hp: 3 }, GameEntity,
    ));

    // Enemy platform + character
    commands.spawn((
        Sprite { color: Color::srgb(0.3, 0.3, 0.35), custom_size: Some(Vec2::new(80.0, 20.0)), ..default() },
        Transform::from_xyz(ENEMY_X, PLATFORM_Y, 0.0), GameEntity,
    ));
    commands.spawn((
        Sprite { color: Color::srgb(0.9, 0.25, 0.25), custom_size: Some(CHAR_SIZE), ..default() },
        Transform::from_xyz(ENEMY_X, PLATFORM_Y + 30.0, 1.0),
        EnemyAI { hp: 3 }, GameEntity,
    ));

    // Destructible blocks in the middle
    let mut rng = rand::thread_rng();
    for row in 0..3 {
        for col in 0..2 {
            let x = -40.0 + (col as f32) * 44.0 + rng.gen_range(-5.0..5.0);
            let y = PLATFORM_Y + (row as f32) * 40.0 + 10.0;
            commands.spawn((
                Sprite { color: Color::srgb(0.5, 0.45, 0.3), custom_size: Some(BLOCK_SIZE), ..default() },
                Transform::from_xyz(x, y, 0.5),
                Platform { destructible: true, hp: 2 }, GameEntity,
            ));
        }
    }

    // HUD
    commands.spawn((
        Text::new("Player HP:3 | Enemy HP:3 | YOUR TURN"),
        TextFont { font_size: 20.0, ..default() },
        TextColor(Color::srgb(0.9, 0.85, 0.3)),
        Node { position_type: PositionType::Absolute, top: Val::Px(10.0), left: Val::Px(10.0), ..default() },
        HudText, GameEntity,
    ));
}

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

pub fn player_fire(
    mouse: Res<ButtonInput<MouseButton>>,
    windows: Query<&Window>,
    camera_q: Query<(&Camera, &GlobalTransform)>,
    mut state: ResMut<GameState>,
    mut commands: Commands,
) {
    if !state.player_turn || state.fired { return; }
    let Ok(win) = windows.get_single() else { return; };
    let Ok((cam, cam_tf)) = camera_q.get_single() else { return; };

    if mouse.just_pressed(MouseButton::Left) {
        if let Some(pos) = win.cursor_position().and_then(|c| cam.viewport_to_world_2d(cam_tf, c).ok()) {
            state.dragging = true;
            state.drag_start = pos;
        }
    }
    if mouse.just_released(MouseButton::Left) && state.dragging {
        state.dragging = false;
        if let Some(pos) = win.cursor_position().and_then(|c| cam.viewport_to_world_2d(cam_tf, c).ok()) {
            let diff = state.drag_start - pos;
            let power = diff.length().min(MAX_POWER);
            let angle = diff.y.atan2(diff.x);
            let vx = power * angle.cos();
            let vy = power * angle.sin();
            commands.spawn((
                Sprite { color: Color::srgb(1.0, 0.9, 0.2), custom_size: Some(PROJ_SIZE), ..default() },
                Transform::from_xyz(PLAYER_X + 20.0, PLATFORM_Y + 40.0, 2.0),
                Projectile { vx, vy, friendly: true }, GameEntity,
            ));
            state.fired = true;
        }
    }
}

pub fn ai_fire(
    time: Res<Time>,
    mut state: ResMut<GameState>,
    mut commands: Commands,
) {
    if state.player_turn { return; }
    state.turn_timer += time.delta_secs();
    if state.turn_timer >= 1.0 && !state.fired {
        state.fired = true;
        let mut rng = rand::thread_rng();
        let power = rng.gen_range(200.0..380.0);
        let angle = rng.gen_range(120.0_f32..160.0).to_radians();
        let vx = power * angle.cos();
        let vy = power * angle.sin();
        commands.spawn((
            Sprite { color: Color::srgb(1.0, 0.4, 0.1), custom_size: Some(PROJ_SIZE), ..default() },
            Transform::from_xyz(ENEMY_X - 20.0, PLATFORM_Y + 40.0, 2.0),
            Projectile { vx, vy, friendly: false }, GameEntity,
        ));
    }
}

pub fn move_projectiles(
    time: Res<Time>,
    mut q: Query<(&mut Transform, &mut Projectile)>,
) {
    let dt = time.delta_secs();
    for (mut tf, mut p) in &mut q {
        p.vy -= GRAVITY * dt;
        tf.translation.x += p.vx * dt;
        tf.translation.y += p.vy * dt;
    }
}

pub fn projectile_collisions(
    mut commands: Commands,
    mut state: ResMut<GameState>,
    proj_q: Query<(Entity, &Transform, &Projectile)>,
    mut player_q: Query<(&Transform, &mut Player), Without<Projectile>>,
    mut enemy_q: Query<(&Transform, &mut EnemyAI), (Without<Projectile>, Without<Player>)>,
    mut block_q: Query<(Entity, &Transform, &mut Platform), Without<Projectile>>,
) {
    for (pe, ptf, proj) in &proj_q {
        // Off-screen
        if ptf.translation.y < -350.0 || ptf.translation.x.abs() > 550.0 {
            commands.entity(pe).despawn();
            switch_turn(&mut state);
            continue;
        }
        let pp = ptf.translation.truncate();

        // Hit blocks
        let mut hit = false;
        for (be, btf, mut block) in &mut block_q {
            let bp = btf.translation.truncate();
            if (pp - bp).length() < 22.0 && block.destructible {
                block.hp -= 1;
                if block.hp <= 0 { commands.entity(be).despawn(); }
                commands.entity(pe).despawn();
                switch_turn(&mut state);
                hit = true;
                break;
            }
        }
        if hit { continue; }

        // Hit enemy
        if proj.friendly {
            for (etf, mut en) in &mut enemy_q {
                let ep = etf.translation.truncate();
                if (pp - ep).length() < 25.0 {
                    en.hp -= 1;
                    state.score += 200;
                    commands.entity(pe).despawn();
                    switch_turn(&mut state);
                    break;
                }
            }
        } else {
            // Hit player
            for (ptf2, mut pl) in &mut player_q {
                let plp = ptf2.translation.truncate();
                if (pp - plp).length() < 25.0 {
                    pl.hp -= 1;
                    commands.entity(pe).despawn();
                    switch_turn(&mut state);
                    break;
                }
            }
        }
    }
}

fn switch_turn(state: &mut GameState) {
    state.player_turn = !state.player_turn;
    state.fired = false;
    state.turn_timer = 0.0;
}

pub fn check_game_over(
    player_q: Query<&Player>,
    enemy_q: Query<&EnemyAI>,
    mut state: ResMut<GameState>,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    if let Ok(p) = player_q.get_single() {
        if p.hp <= 0 {
            next_state.set(crate::AppState::GameOver);
            return;
        }
    }
    if let Ok(e) = enemy_q.get_single() {
        if e.hp <= 0 {
            state.score += 500;
            next_state.set(crate::AppState::GameOver);
        }
    }
}

pub fn update_score(state: Res<GameState>, mut bridge: ResMut<BevyBridge>) {
    bridge.current_score = state.score;
}

pub fn update_hud(
    player_q: Query<&Player>,
    enemy_q: Query<&EnemyAI>,
    state: Res<GameState>,
    mut q: Query<&mut Text, With<HudText>>,
) {
    let php = player_q.get_single().map(|p| p.hp).unwrap_or(0);
    let ehp = enemy_q.get_single().map(|e| e.hp).unwrap_or(0);
    let turn = if state.player_turn { "YOUR TURN" } else { "ENEMY TURN" };
    for mut t in &mut q {
        **t = format!("Player HP:{} | Enemy HP:{} | {}", php, ehp, turn);
    }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

pub fn cleanup(mut commands: Commands, q: Query<Entity, With<GameEntity>>) {
    for e in &q { commands.entity(e).despawn(); }
    commands.remove_resource::<GameState>();
}
