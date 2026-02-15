use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLS: i32 = 10;
const ROWS: i32 = 15;
const TILE: f32 = 40.0;
const ORIGIN_X: f32 = -180.0;
const ORIGIN_Y: f32 = -280.0;
const MOVE_CD: f32 = 0.12;
const SKY_ROWS: i32 = 2;
const SURFACE_ROW: i32 = 2; // row index (from bottom=0, so row 12 from top)
const MAX_FUEL: i32 = 100;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

#[derive(Component)]
pub struct GameEntity;

#[derive(Clone, Copy, PartialEq)]
enum MineralKind { None, Copper, Silver, Gold, Diamond }

#[derive(Clone, Copy, PartialEq)]
enum TileKind { Sky, Surface, Dirt, Rock }

#[derive(Component)]
struct Tile {
    gx: i32,
    gy: i32,
    kind: TileKind,
    mineral: MineralKind,
}

#[derive(Component)]
struct Player {
    gx: i32,
    gy: i32,
    fuel: i32,
    cargo_value: i32,
}

#[derive(Component)]
struct ScoreText;

#[derive(Resource)]
struct GameState {
    score: i32,
    move_cd: f32,
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

pub fn setup(mut commands: Commands) {
    commands.insert_resource(GameState { score: 0, move_cd: 0.0 });

    // Background
    commands.spawn((
        Sprite { color: Color::srgb(0.04, 0.04, 0.08), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
        Transform::from_xyz(0.0, 0.0, -1.0),
        GameEntity,
    ));

    let mut rng = rand::thread_rng();

    // Generate grid (row 0 = bottom, row 14 = top)
    for row in 0..ROWS {
        for col in 0..COLS {
            let from_top = ROWS - 1 - row;
            let (kind, mineral) = if from_top < SKY_ROWS {
                (TileKind::Sky, MineralKind::None)
            } else if from_top == SKY_ROWS {
                (TileKind::Surface, MineralKind::None)
            } else {
                // Underground
                let depth = from_top - SKY_ROWS; // 1..12
                if rng.gen_range(0..10) == 0 {
                    (TileKind::Rock, MineralKind::None)
                } else {
                    let mineral = roll_mineral(&mut rng, depth);
                    (TileKind::Dirt, mineral)
                }
            };

            let color = tile_color(kind, mineral);
            let (px, py) = grid_to_world(col, row);

            if kind == TileKind::Sky { continue; } // don't spawn sky tiles

            commands.spawn((
                Sprite { color, custom_size: Some(Vec2::new(TILE - 2.0, TILE - 2.0)), ..default() },
                Transform::from_xyz(px, py, 0.0),
                Tile { gx: col, gy: row, kind, mineral },
                GameEntity,
            ));
        }
    }

    // Player on surface
    let surface_gy = ROWS - 1 - SKY_ROWS; // top row that is surface
    let (px, py) = grid_to_world(COLS / 2, surface_gy + 1); // stand above surface
    commands.spawn((
        Sprite { color: Color::srgb(0.2, 0.6, 1.0), custom_size: Some(Vec2::new(TILE - 8.0, TILE - 8.0)), ..default() },
        Transform::from_xyz(px, py, 1.0),
        Player { gx: COLS / 2, gy: surface_gy + 1, fuel: MAX_FUEL, cargo_value: 0 },
        GameEntity,
    ));

    // HUD
    commands.spawn((
        Text::new("Fuel: 100 | Cargo: $0 | Score: 0"),
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

pub fn player_move(
    keys: Res<ButtonInput<KeyCode>>,
    time: Res<Time>,
    mut state: ResMut<GameState>,
    mut commands: Commands,
    mut pq: Query<(&mut Transform, &mut Player)>,
    tiles: Query<(Entity, &Tile)>,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    state.move_cd -= time.delta_secs();
    if state.move_cd > 0.0 { return; }
    let Ok((mut ptf, mut player)) = pq.get_single_mut() else { return };

    let (mut dx, mut dy) = (0i32, 0i32);
    if keys.pressed(KeyCode::ArrowLeft) { dx = -1; }
    else if keys.pressed(KeyCode::ArrowRight) { dx = 1; }
    else if keys.pressed(KeyCode::ArrowDown) { dy = -1; }
    else if keys.pressed(KeyCode::ArrowUp) { dy = 1; }

    if dx == 0 && dy == 0 { return; }

    let nx = player.gx + dx;
    let ny = player.gy + dy;
    if nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS { return; }

    // Check what's at destination
    let mut dest_entity: Option<Entity> = None;
    let mut dest_tile: Option<(TileKind, MineralKind)> = None;
    for (e, tile) in &tiles {
        if tile.gx == nx && tile.gy == ny {
            dest_entity = Some(e);
            dest_tile = Some((tile.kind, tile.mineral));
            break;
        }
    }

    match dest_tile {
        Some((TileKind::Rock, _)) => { return; } // can't dig rock
        Some((TileKind::Dirt, mineral)) => {
            // Dig: costs fuel
            if player.fuel <= 0 {
                next_state.set(crate::AppState::GameOver);
                return;
            }
            player.fuel -= 1;
            let value = mineral_value(mineral);
            player.cargo_value += value;
            if let Some(e) = dest_entity {
                commands.entity(e).despawn();
            }
        }
        Some((TileKind::Surface, _)) => {
            // Sell cargo when reaching surface
            state.score += player.cargo_value;
            player.cargo_value = 0;
        }
        _ => {} // Sky or empty: free movement
    }

    player.gx = nx;
    player.gy = ny;
    let (wx, wy) = grid_to_world(nx, ny);
    ptf.translation.x = wx;
    ptf.translation.y = wy;
    state.move_cd = MOVE_CD;

    // Check fuel
    if player.fuel <= 0 {
        state.score += player.cargo_value;
        next_state.set(crate::AppState::GameOver);
    }
}

pub fn gravity(
    time: Res<Time>,
    mut pq: Query<(&mut Transform, &mut Player)>,
    tiles: Query<&Tile>,
) {
    // Simple: if nothing below and not on surface+, fall
    let Ok((mut ptf, mut player)) = pq.get_single_mut() else { return };
    if player.gy <= 0 { return; }

    let below_gy = player.gy - 1;
    let supported = tiles.iter().any(|t| t.gx == player.gx && t.gy == below_gy);
    if !supported {
        player.gy = below_gy;
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
    for mut t in &mut sq {
        **t = format!("Fuel: {} | Cargo: ${} | Score: {}", player.fuel, player.cargo_value, state.score);
    }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

pub fn cleanup(mut commands: Commands, q: Query<Entity, With<GameEntity>>) {
    for e in &q { commands.entity(e).despawn(); }
    commands.remove_resource::<GameState>();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn grid_to_world(gx: i32, gy: i32) -> (f32, f32) {
    (ORIGIN_X + gx as f32 * TILE, ORIGIN_Y + gy as f32 * TILE)
}

fn roll_mineral(rng: &mut impl Rng, depth: i32) -> MineralKind {
    let r = rng.gen_range(0..100);
    match depth {
        0..=2 => {
            if r < 30 { MineralKind::Copper } else { MineralKind::None }
        }
        3..=5 => {
            if r < 20 { MineralKind::Copper }
            else if r < 35 { MineralKind::Silver }
            else { MineralKind::None }
        }
        6..=8 => {
            if r < 10 { MineralKind::Copper }
            else if r < 25 { MineralKind::Silver }
            else if r < 35 { MineralKind::Gold }
            else { MineralKind::None }
        }
        _ => {
            if r < 10 { MineralKind::Silver }
            else if r < 25 { MineralKind::Gold }
            else if r < 33 { MineralKind::Diamond }
            else { MineralKind::None }
        }
    }
}

fn mineral_value(m: MineralKind) -> i32 {
    match m {
        MineralKind::None => 0,
        MineralKind::Copper => 10,
        MineralKind::Silver => 25,
        MineralKind::Gold => 50,
        MineralKind::Diamond => 100,
    }
}

fn tile_color(kind: TileKind, mineral: MineralKind) -> Color {
    match kind {
        TileKind::Sky => Color::srgb(0.4, 0.6, 0.9),
        TileKind::Surface => Color::srgb(0.3, 0.6, 0.2),
        TileKind::Rock => Color::srgb(0.4, 0.4, 0.4),
        TileKind::Dirt => match mineral {
            MineralKind::None => Color::srgb(0.35, 0.22, 0.12),
            MineralKind::Copper => Color::srgb(0.7, 0.4, 0.2),
            MineralKind::Silver => Color::srgb(0.7, 0.7, 0.75),
            MineralKind::Gold => Color::srgb(0.9, 0.75, 0.1),
            MineralKind::Diamond => Color::srgb(0.6, 0.85, 1.0),
        },
    }
}
