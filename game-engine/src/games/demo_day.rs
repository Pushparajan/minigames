use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;
use crate::pixar::{self, PixarAssets, CharacterConfig, palette};
use crate::asset_loader::CustomAssets;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLS: i32 = 8;
const ROWS: i32 = 6;
const TILE: f32 = 55.0;
const ORIGIN_X: f32 = -192.5;
const ORIGIN_Y: f32 = -137.5;
const MAX_EXPLOSIVES: i32 = 5;
const BLAST_RADIUS: i32 = 1; // tiles in each direction
const SETTLE_TICK: f32 = 0.08;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

#[derive(Component)]
pub struct GameEntity;

#[derive(Component)]
struct Block {
    gx: i32,
    gy: i32,
    marked: bool,
}

#[derive(Component)]
struct ExplosionVfx {
    timer: f32,
}

#[derive(Component)]
struct ScoreText;

#[derive(Component)]
struct CursorVis;

#[derive(Resource)]
struct GameState {
    score: i32,
    explosives_placed: i32,
    detonated: bool,
    settling: bool,
    settle_timer: f32,
    done: bool,
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

pub fn setup(mut commands: Commands, pixar_assets: Res<PixarAssets>, custom_assets: Res<CustomAssets>) {
    commands.insert_resource(GameState {
        score: 0, explosives_placed: 0, detonated: false,
        settling: false, settle_timer: 0.0, done: false,
    });

    // Background
    if let Some(ref bg_handle) = custom_assets.background {
        commands.spawn((
            Sprite { image: bg_handle.clone(), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
            Transform::from_xyz(0.0, 0.0, -1.0),
            GameEntity,
        ));
    } else {
        commands.spawn((
            Sprite { color: palette::SKY_BLUE, custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
            Transform::from_xyz(0.0, 0.0, -1.0),
            GameEntity,
        ));
    }

    // Ground — prop
    let ground_size = Vec2::new(960.0, 30.0);
    let ground_config = CharacterConfig::prop(palette::GROUND_BROWN, ground_size, false);
    pixar::spawn_character(
        &mut commands,
        &pixar_assets,
        &ground_config,
        Vec3::new(0.0, ORIGIN_Y - TILE / 2.0 - 15.0, 0.0),
        (GameEntity,),
    );

    // Building blocks — props
    let mut rng = rand::thread_rng();
    let colors = [
        Color::srgb(0.7, 0.3, 0.3),
        Color::srgb(0.3, 0.5, 0.7),
        Color::srgb(0.6, 0.6, 0.3),
        Color::srgb(0.4, 0.7, 0.4),
    ];
    for row in 0..ROWS {
        for col in 0..COLS {
            let c = colors[rng.gen_range(0..colors.len())];
            let (px, py) = grid_to_world(col, row);
            let block_size = Vec2::new(TILE - 4.0, TILE - 4.0);
            let config = CharacterConfig::prop(c, block_size, false);
            pixar::spawn_character(
                &mut commands,
                &pixar_assets,
                &config,
                Vec3::new(px, py, 0.0),
                (Block { gx: col, gy: row, marked: false }, GameEntity),
            );
        }
    }

    // HUD
    commands.spawn((
        Text::new("Click blocks to place explosives (5). Space to detonate."),
        TextFont { font_size: 20.0, ..default() },
        TextColor(Color::srgb(0.9, 0.85, 0.3)),
        Node { position_type: PositionType::Absolute, top: Val::Px(10.0), left: Val::Px(10.0), ..default() },
        ScoreText,
        GameEntity,
    ));
}

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

pub fn place_explosive(
    mouse: Res<ButtonInput<MouseButton>>,
    windows: Query<&Window>,
    camera_q: Query<(&Camera, &GlobalTransform)>,
    mut blocks: Query<(&mut Block, &mut Sprite, &Transform)>,
    mut state: ResMut<GameState>,
) {
    if state.detonated || state.done { return; }
    if !mouse.just_pressed(MouseButton::Left) { return; }
    if state.explosives_placed >= MAX_EXPLOSIVES { return; }

    let Ok(window) = windows.get_single() else { return };
    let Some(cursor) = window.cursor_position() else { return };
    let Ok((camera, cam_tf)) = camera_q.get_single() else { return };
    let Ok(world_pos) = camera.viewport_to_world_2d(cam_tf, cursor) else { return };

    for (mut block, mut spr, tf) in &mut blocks {
        if block.marked { continue; }
        let dx = (world_pos.x - tf.translation.x).abs();
        let dy = (world_pos.y - tf.translation.y).abs();
        if dx < TILE / 2.0 && dy < TILE / 2.0 {
            block.marked = true;
            spr.color = palette::VILLAIN_RED;
            state.explosives_placed += 1;
            break;
        }
    }
}

pub fn detonate(
    keys: Res<ButtonInput<KeyCode>>,
    mut state: ResMut<GameState>,
    mut commands: Commands,
    pixar_assets: Res<PixarAssets>,
    blocks: Query<(Entity, &Block, &Transform)>,
) {
    if state.detonated || state.done { return; }
    if !keys.just_pressed(KeyCode::Space) { return; }

    state.detonated = true;

    // Collect marked positions
    let marked: Vec<(i32, i32)> = blocks.iter()
        .filter(|(_, b, _)| b.marked)
        .map(|(_, b, _)| (b.gx, b.gy))
        .collect();

    // Destroy blocks in blast radius
    let mut destroyed = 0i32;
    let to_destroy: Vec<Entity> = blocks.iter()
        .filter(|(_, b, _)| {
            marked.iter().any(|(mx, my)| {
                (b.gx - mx).abs() <= BLAST_RADIUS && (b.gy - my).abs() <= BLAST_RADIUS
            })
        })
        .map(|(e, _, _)| e)
        .collect();

    for e in &to_destroy {
        commands.entity(*e).despawn_recursive();
        destroyed += 1;
    }

    state.score += destroyed * 10;

    // Spawn explosion VFX at marked positions — projectile style
    for (mx, my) in &marked {
        let (px, py) = grid_to_world(*mx, *my);
        let config = CharacterConfig::projectile(palette::VILLAIN_RED, TILE * 2.5);
        pixar::spawn_character(
            &mut commands,
            &pixar_assets,
            &config,
            Vec3::new(px, py, 2.0),
            (ExplosionVfx { timer: 0.5 }, GameEntity),
        );
    }

    state.settling = true;
    state.settle_timer = 0.5; // delay before gravity
}

pub fn explosion_vfx(
    time: Res<Time>,
    mut commands: Commands,
    mut vfx: Query<(Entity, &mut ExplosionVfx, &mut Sprite)>,
) {
    let dt = time.delta_secs();
    for (e, mut fx, mut spr) in &mut vfx {
        fx.timer -= dt;
        spr.color = spr.color.with_alpha(fx.timer.max(0.0) * 2.0);
        if fx.timer <= 0.0 {
            commands.entity(e).despawn_recursive();
        }
    }
}

pub fn gravity_settle(
    time: Res<Time>,
    mut state: ResMut<GameState>,
    mut blocks: Query<(&mut Block, &mut Transform)>,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    if !state.settling { return; }

    state.settle_timer -= time.delta_secs();
    if state.settle_timer > 0.0 { return; }
    state.settle_timer = SETTLE_TICK;

    let mut moved = false;
    // Collect occupied positions
    let occupied: Vec<(i32, i32)> = blocks.iter().map(|(b, _)| (b.gx, b.gy)).collect();

    for (mut block, mut tf) in &mut blocks {
        if block.gy <= 0 { continue; }
        let below = (block.gx, block.gy - 1);
        if !occupied.contains(&below) {
            block.gy -= 1;
            let (px, py) = grid_to_world(block.gx, block.gy);
            tf.translation.x = px;
            tf.translation.y = py;
            moved = true;
        }
    }

    if !moved {
        state.settling = false;
        state.done = true;
        next_state.set(crate::AppState::GameOver);
    }
}

pub fn update_score(state: Res<GameState>, mut bridge: ResMut<BevyBridge>) {
    bridge.current_score = state.score;
}

pub fn update_hud(state: Res<GameState>, mut sq: Query<&mut Text, With<ScoreText>>) {
    for mut t in &mut sq {
        if state.detonated {
            **t = format!("Score: {} | BOOM!", state.score);
        } else {
            **t = format!("Score: {} | Explosives: {}/{}", state.score, state.explosives_placed, MAX_EXPLOSIVES);
        }
    }
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

fn grid_to_world(gx: i32, gy: i32) -> (f32, f32) {
    (ORIGIN_X + gx as f32 * TILE, ORIGIN_Y + gy as f32 * TILE)
}
