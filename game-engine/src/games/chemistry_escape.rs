use bevy::prelude::*;

use crate::BevyBridge;
use crate::pixar::{self, PixarAssets, CharacterConfig, palette};
use crate::asset_loader::CustomAssets;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLS: i32 = 12;
const ROWS: i32 = 8;
const TILE: f32 = 50.0;
const ORIGIN_X: f32 = -275.0;
const ORIGIN_Y: f32 = -175.0;
const GRAVITY_TICK: f32 = 0.12;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

#[derive(Component)]
pub struct GameEntity;

#[derive(Component)]
struct Player {
    gx: i32,
    gy: i32,
    keys: [bool; 3], // R, G, B
}

#[derive(Component)]
struct ScoreText;

#[derive(Clone, Copy, PartialEq)]
enum TileKind {
    Wall,
    Floor,
    Key(usize),   // 0=R,1=G,2=B
    Door(usize),
    Acid,
    Exit,
    Empty,
}

#[derive(Component)]
struct Tile {
    gx: i32,
    gy: i32,
    kind: TileKind,
}

#[derive(Resource)]
struct GameState {
    score: i32,
    move_cooldown: f32,
    gravity_timer: f32,
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

pub fn setup(mut commands: Commands, pixar_assets: Res<PixarAssets>, custom_assets: Res<CustomAssets>) {
    commands.insert_resource(GameState { score: 0, move_cooldown: 0.0, gravity_timer: 0.0 });

    // Background
    let bg_color = palette::LAB_BG;
    if let Some(ref bg_handle) = custom_assets.background {
        commands.spawn((
            Sprite { image: bg_handle.clone(), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
            Transform::from_xyz(0.0, 0.0, -1.0),
            GameEntity,
        ));
    } else {
        commands.spawn((
            Sprite { color: bg_color, custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
            Transform::from_xyz(0.0, 0.0, -1.0),
            GameEntity,
        ));
    }

    // Level layout (row 0 = bottom)
    let level = build_level();
    for row in 0..ROWS {
        for col in 0..COLS {
            let kind = level[row as usize][col as usize];
            if kind == TileKind::Empty { continue; }
            let (px, py) = grid_to_world(col, row);
            let tile_size = Vec2::new(TILE - 2.0, TILE - 2.0);
            spawn_tile(&mut commands, &pixar_assets, kind, tile_size, Vec3::new(px, py, 0.0), col, row);
        }
    }

    // Player at (1,1)
    let (px, py) = grid_to_world(1, 1);
    let player_size = Vec2::new(TILE - 8.0, TILE - 8.0);
    let player_config = CharacterConfig::hero(palette::HERO_GREEN, player_size);
    pixar::spawn_character(
        &mut commands,
        &pixar_assets,
        &player_config,
        Vec3::new(px, py, 1.0),
        (Player { gx: 1, gy: 1, keys: [false; 3] }, GameEntity),
    );

    // HUD
    commands.spawn((
        Text::new("Score: 0 | Keys: ---"),
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

pub fn player_move(
    keys: Res<ButtonInput<KeyCode>>,
    time: Res<Time>,
    mut state: ResMut<GameState>,
    mut pq: Query<(&mut Transform, &mut Player)>,
    tiles: Query<(Entity, &Tile, &Sprite)>,
    mut commands: Commands,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    state.move_cooldown -= time.delta_secs();
    if state.move_cooldown > 0.0 { return; }

    let Ok((mut ptf, mut player)) = pq.get_single_mut() else { return };

    let (mut dx, mut dy) = (0i32, 0i32);
    if keys.pressed(KeyCode::ArrowLeft) { dx = -1; }
    else if keys.pressed(KeyCode::ArrowRight) { dx = 1; }
    else if keys.pressed(KeyCode::ArrowUp) { dy = 1; }

    if dx == 0 && dy == 0 { return; }

    let nx = player.gx + dx;
    let ny = player.gy + dy;

    if nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS { return; }

    // Check tile at target
    let mut blocked = false;
    let mut despawn_tile: Option<Entity> = None;
    for (_e, tile, _) in &tiles {
        if tile.gx == nx && tile.gy == ny {
            match tile.kind {
                TileKind::Wall | TileKind::Floor => { blocked = true; }
                TileKind::Door(c) => {
                    if !player.keys[c] { blocked = true; }
                    // unlocked door = pass through & remove
                }
                _ => {}
            }
        }
    }
    if blocked { return; }

    // Move player
    player.gx = nx;
    player.gy = ny;
    let (wx, wy) = grid_to_world(nx, ny);
    ptf.translation.x = wx;
    ptf.translation.y = wy;
    state.move_cooldown = 0.15;

    // Check interactions at new position
    for (ent, tile, _) in &tiles {
        if tile.gx != nx || tile.gy != ny { continue; }
        match tile.kind {
            TileKind::Key(c) => {
                player.keys[c] = true;
                despawn_tile = Some(ent);
            }
            TileKind::Door(c) if player.keys[c] => {
                despawn_tile = Some(ent);
            }
            TileKind::Acid => {
                next_state.set(crate::AppState::GameOver);
                return;
            }
            TileKind::Exit => {
                if player.keys.iter().all(|k| *k) {
                    state.score += 1000;
                }
                next_state.set(crate::AppState::GameOver);
                return;
            }
            _ => {}
        }
    }
    if let Some(e) = despawn_tile {
        commands.entity(e).despawn_recursive();
    }
}

pub fn gravity(
    time: Res<Time>,
    mut state: ResMut<GameState>,
    mut pq: Query<(&mut Transform, &mut Player)>,
    tiles: Query<&Tile>,
) {
    state.gravity_timer += time.delta_secs();
    if state.gravity_timer < GRAVITY_TICK { return; }
    state.gravity_timer = 0.0;

    let Ok((mut ptf, mut player)) = pq.get_single_mut() else { return };
    if player.gy <= 0 { return; }

    let below = player.gy - 1;
    let mut supported = false;
    for tile in &tiles {
        if tile.gx == player.gx && tile.gy == below {
            match tile.kind {
                TileKind::Wall | TileKind::Floor | TileKind::Door(_) => { supported = true; }
                _ => {}
            }
        }
    }
    if !supported {
        player.gy = below;
        let (wx, wy) = grid_to_world(player.gx, player.gy);
        ptf.translation.x = wx;
        ptf.translation.y = wy;
    }
}

pub fn update_score(state: Res<GameState>, mut bridge: ResMut<BevyBridge>) {
    bridge.current_score = state.score;
}

pub fn update_hud(
    state: Res<GameState>,
    pq: Query<&Player>,
    mut sq: Query<&mut Text, With<ScoreText>>,
) {
    let Ok(player) = pq.get_single() else { return };
    let k = |i: usize| if player.keys[i] { ['R','G','B'][i] } else { '-' };
    for mut t in &mut sq {
        **t = format!("Score: {} | Keys: {}{}{}", state.score, k(0), k(1), k(2));
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

fn spawn_tile(commands: &mut Commands, pixar_assets: &PixarAssets, kind: TileKind, size: Vec2, position: Vec3, gx: i32, gy: i32) {
    match kind {
        TileKind::Key(c) => {
            // Keys are collectibles with faces
            let color = match c {
                0 => Color::srgb(1.0, 0.2, 0.2),
                1 => Color::srgb(0.2, 1.0, 0.2),
                _ => Color::srgb(0.2, 0.2, 1.0),
            };
            let config = CharacterConfig::collectible(color, size.x);
            pixar::spawn_character(
                commands,
                pixar_assets,
                &config,
                position,
                (Tile { gx, gy, kind }, GameEntity),
            );
        }
        TileKind::Exit => {
            // Exit is a collectible (gold)
            let config = CharacterConfig::collectible(palette::GOLD, size.x);
            pixar::spawn_character(
                commands,
                pixar_assets,
                &config,
                position,
                (Tile { gx, gy, kind }, GameEntity),
            );
        }
        TileKind::Acid => {
            // Acid gets round_sprite with green glow
            let color = Color::srgb(0.4, 1.0, 0.0);
            commands.spawn((
                pixar::round_sprite(pixar_assets, color, size),
                Transform::from_translation(position),
                Tile { gx, gy, kind },
                GameEntity,
            ));
        }
        TileKind::Wall => {
            let config = CharacterConfig::prop(Color::srgb(0.35, 0.35, 0.4), size, false);
            pixar::spawn_character(
                commands,
                pixar_assets,
                &config,
                position,
                (Tile { gx, gy, kind }, GameEntity),
            );
        }
        TileKind::Floor => {
            let config = CharacterConfig::prop(palette::GROUND_BROWN, size, false);
            pixar::spawn_character(
                commands,
                pixar_assets,
                &config,
                position,
                (Tile { gx, gy, kind }, GameEntity),
            );
        }
        TileKind::Door(c) => {
            let color = match c {
                0 => Color::srgb(0.7, 0.1, 0.1),
                1 => Color::srgb(0.1, 0.7, 0.1),
                _ => Color::srgb(0.1, 0.1, 0.7),
            };
            let config = CharacterConfig::prop(color, size, false);
            pixar::spawn_character(
                commands,
                pixar_assets,
                &config,
                position,
                (Tile { gx, gy, kind }, GameEntity),
            );
        }
        TileKind::Empty => {} // never reached
    }
}

fn build_level() -> Vec<Vec<TileKind>> {
    use TileKind::*;
    let w = Wall; let f = Floor; let e = Empty;
    let kr = Key(0); let kg = Key(1); let kb = Key(2);
    let dr = Door(0); let dg = Door(1); let db = Door(2);
    let a = Acid; let x = Exit;
    // row 0=bottom, row 7=top
    vec![
        vec![w, f, f, f, f, a, a, f, f, f, f, w],  // 0
        vec![w, e, e, e, e, e, e, e, e, e, e, w],  // 1
        vec![w, e, e, f, f, f, e, e, f, f, kr, w],  // 2
        vec![w, e, e, e, e, e, e, e, e, e, e, w],  // 3
        vec![w, f, f, dr, e, e, f, f, dg, e, e, w], // 4
        vec![w, kg, e, e, e, e, e, e, e, e, e, w],  // 5
        vec![w, e, e, e, f, db, f, f, f, kb, e, w],  // 6
        vec![w, w, w, w, w, w, w, w, w, w, x, w],  // 7
    ]
}
