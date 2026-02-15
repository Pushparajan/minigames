use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HALF_W: f32 = 440.0;
const HALF_H: f32 = 300.0;
const PLAYER_Y: f32 = -HALF_H + 20.0;
const PLAYER_W: f32 = 50.0;
const PLAYER_H: f32 = 14.0;
const PLAYER_SPEED: f32 = 400.0;
const HARPOON_W: f32 = 4.0;
const HARPOON_SPEED: f32 = 600.0;
const MIN_RADIUS: f32 = 10.0;
const SPLIT_RATIO: f32 = 0.6;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

#[derive(Component)]
pub struct GameEntity;

#[derive(Component)]
struct Player { x: f32 }

#[derive(Component)]
struct Harpoon { active: bool }

#[derive(Component)]
struct Molecule { radius: f32, vx: f32, vy: f32 }

#[derive(Component)]
struct ScoreText;

#[derive(Component)]
struct LivesText;

#[derive(Resource)]
struct GameState {
    score: i32,
    lives: i32,
    level: usize,
    invuln: f32,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn spawn_molecules(commands: &mut Commands, level: usize) {
    let mut rng = rand::thread_rng();
    let count = level + 1;
    let base_radius = 35.0 + level as f32 * 10.0;
    for i in 0..count {
        let x = rng.gen_range(-HALF_W * 0.5..HALF_W * 0.5);
        let y = rng.gen_range(0.0..HALF_H * 0.6);
        let vx = rng.gen_range(-120.0..120.0);
        let vy = rng.gen_range(-80.0..80.0);
        let colors = [
            Color::srgb(1.0, 0.3, 0.3),
            Color::srgb(0.3, 1.0, 0.5),
            Color::srgb(0.3, 0.5, 1.0),
            Color::srgb(1.0, 0.8, 0.2),
        ];
        let color = colors[i % colors.len()];
        let r = base_radius;
        commands.spawn((
            Sprite { color, custom_size: Some(Vec2::splat(r * 2.0)), ..default() },
            Transform::from_xyz(x, y, 0.5),
            Molecule { radius: r, vx, vy },
            GameEntity,
        ));
    }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

pub fn setup(mut commands: Commands) {
    commands.insert_resource(GameState { score: 0, lives: 3, level: 0, invuln: 0.0 });

    // Background
    commands.spawn((
        Sprite { color: Color::srgb(0.03, 0.03, 0.1), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
        Transform::from_xyz(0.0, 0.0, -1.0),
        GameEntity,
    ));

    // Boundary walls (visual)
    for (x, y, w, h) in [
        (0.0, HALF_H, HALF_W * 2.0 + 20.0, 10.0),
        (0.0, -HALF_H, HALF_W * 2.0 + 20.0, 10.0),
        (-HALF_W - 5.0, 0.0, 10.0, HALF_H * 2.0),
        (HALF_W + 5.0, 0.0, 10.0, HALF_H * 2.0),
    ] {
        commands.spawn((
            Sprite { color: Color::srgb(0.3, 0.3, 0.35), custom_size: Some(Vec2::new(w, h)), ..default() },
            Transform::from_xyz(x, y, 0.1),
            GameEntity,
        ));
    }

    // Player
    commands.spawn((
        Sprite { color: Color::srgb(0.2, 0.8, 0.4), custom_size: Some(Vec2::new(PLAYER_W, PLAYER_H)), ..default() },
        Transform::from_xyz(0.0, PLAYER_Y, 1.0),
        Player { x: 0.0 },
        GameEntity,
    ));

    spawn_molecules(&mut commands, 0);

    // HUD
    commands.spawn((
        Text::new("Score: 0"),
        TextFont { font_size: 20.0, ..default() },
        TextColor(Color::srgb(0.9, 0.85, 0.3)),
        Node { position_type: PositionType::Absolute, top: Val::Px(8.0), left: Val::Px(8.0), ..default() },
        ScoreText, GameEntity,
    ));
    commands.spawn((
        Text::new("Lives: 3"),
        TextFont { font_size: 20.0, ..default() },
        TextColor(Color::srgb(1.0, 0.4, 0.4)),
        Node { position_type: PositionType::Absolute, top: Val::Px(8.0), right: Val::Px(8.0), ..default() },
        LivesText, GameEntity,
    ));
}

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

pub fn player_input(
    keys: Res<ButtonInput<KeyCode>>,
    time: Res<Time>,
    mut pq: Query<(&mut Player, &mut Transform)>,
    mut commands: Commands,
    hq: Query<&Harpoon>,
) {
    let dt = time.delta_secs();
    let Ok((mut player, mut tf)) = pq.get_single_mut() else { return };

    if keys.pressed(KeyCode::ArrowLeft) { player.x -= PLAYER_SPEED * dt; }
    if keys.pressed(KeyCode::ArrowRight) { player.x += PLAYER_SPEED * dt; }
    player.x = player.x.clamp(-HALF_W + PLAYER_W / 2.0, HALF_W - PLAYER_W / 2.0);
    tf.translation.x = player.x;

    // Fire harpoon (only one at a time)
    if keys.just_pressed(KeyCode::Space) && hq.is_empty() {
        commands.spawn((
            Sprite { color: Color::srgb(1.0, 1.0, 1.0), custom_size: Some(Vec2::new(HARPOON_W, 12.0)), ..default() },
            Transform::from_xyz(player.x, PLAYER_Y + 15.0, 0.8),
            Harpoon { active: true },
            GameEntity,
        ));
    }
}

pub fn move_harpoon(
    time: Res<Time>,
    mut commands: Commands,
    mut hq: Query<(Entity, &mut Transform, &Harpoon)>,
) {
    let dt = time.delta_secs();
    for (e, mut tf, _) in &mut hq {
        tf.translation.y += HARPOON_SPEED * dt;
        // Stretch visual from player to tip
        let height = tf.translation.y - PLAYER_Y;
        if height > 0.0 {
            if let Some(ref mut sprite_size) = None::<Vec2> {
                // unused
                let _ = sprite_size;
            }
        }
        if tf.translation.y > HALF_H {
            commands.entity(e).despawn();
        }
    }
}

pub fn move_molecules(
    time: Res<Time>,
    mut mq: Query<(&mut Molecule, &mut Transform)>,
) {
    let dt = time.delta_secs();
    for (mut mol, mut tf) in &mut mq {
        tf.translation.x += mol.vx * dt;
        tf.translation.y += mol.vy * dt;

        // Bounce off walls
        if tf.translation.x - mol.radius < -HALF_W { tf.translation.x = -HALF_W + mol.radius; mol.vx = mol.vx.abs(); }
        if tf.translation.x + mol.radius > HALF_W { tf.translation.x = HALF_W - mol.radius; mol.vx = -mol.vx.abs(); }
        if tf.translation.y + mol.radius > HALF_H { tf.translation.y = HALF_H - mol.radius; mol.vy = -mol.vy.abs(); }
        if tf.translation.y - mol.radius < -HALF_H { tf.translation.y = -HALF_H + mol.radius; mol.vy = mol.vy.abs(); }
    }
}

pub fn check_harpoon_hit(
    mut commands: Commands,
    mut state: ResMut<GameState>,
    hq: Query<(Entity, &Transform), With<Harpoon>>,
    mq: Query<(Entity, &Transform, &Molecule)>,
) {
    for (he, htf) in &hq {
        for (me, mtf, mol) in &mq {
            let dx = (htf.translation.x - mtf.translation.x).abs();
            let dy = (htf.translation.y - mtf.translation.y).abs();
            if dx < mol.radius + HARPOON_W / 2.0 && dy < mol.radius {
                commands.entity(he).despawn();
                commands.entity(me).despawn();
                state.score += 100;

                // Split if big enough
                let new_r = mol.radius * SPLIT_RATIO;
                if new_r >= MIN_RADIUS {
                    let mut rng = rand::thread_rng();
                    let speed = rng.gen_range(80.0..160.0);
                    for dir in [-1.0f32, 1.0] {
                        commands.spawn((
                            Sprite {
                                color: Color::srgb(rng.gen_range(0.4..1.0), rng.gen_range(0.3..0.8), rng.gen_range(0.3..1.0)),
                                custom_size: Some(Vec2::splat(new_r * 2.0)),
                                ..default()
                            },
                            Transform::from_xyz(mtf.translation.x + dir * new_r, mtf.translation.y, 0.5),
                            Molecule { radius: new_r, vx: dir * speed, vy: -mol.vy.abs().max(60.0) },
                            GameEntity,
                        ));
                    }
                }
                break;
            }
        }
    }
}

pub fn check_player_hit(
    mut state: ResMut<GameState>,
    time: Res<Time>,
    pq: Query<&Transform, With<Player>>,
    mq: Query<(&Transform, &Molecule)>,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    state.invuln -= time.delta_secs();
    if state.invuln > 0.0 { return; }

    let Ok(ptf) = pq.get_single() else { return };
    for (mtf, mol) in &mq {
        let dx = (ptf.translation.x - mtf.translation.x).abs();
        let dy = (ptf.translation.y - mtf.translation.y).abs();
        if dx < PLAYER_W / 2.0 + mol.radius && dy < PLAYER_H / 2.0 + mol.radius {
            state.lives -= 1;
            state.invuln = 1.5;
            if state.lives <= 0 {
                next_state.set(crate::AppState::GameOver);
            }
            return;
        }
    }
}

pub fn check_level_clear(
    mut state: ResMut<GameState>,
    mq: Query<&Molecule>,
    mut commands: Commands,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    if !mq.is_empty() { return; }

    state.level += 1;
    if state.level >= 5 {
        next_state.set(crate::AppState::GameOver);
        return;
    }
    spawn_molecules(&mut commands, state.level);
}

pub fn update_score(state: Res<GameState>, mut bridge: ResMut<BevyBridge>) {
    bridge.current_score = state.score;
}

pub fn update_hud(
    state: Res<GameState>,
    mut sq: Query<&mut Text, (With<ScoreText>, Without<LivesText>)>,
    mut lq: Query<&mut Text, With<LivesText>>,
) {
    for mut t in &mut sq { **t = format!("Score: {} | Lvl {}", state.score, state.level + 1); }
    for mut t in &mut lq { **t = format!("Lives: {}", state.lives); }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

pub fn cleanup(mut commands: Commands, q: Query<Entity, With<GameEntity>>) {
    for e in &q { commands.entity(e).despawn(); }
    commands.remove_resource::<GameState>();
}
