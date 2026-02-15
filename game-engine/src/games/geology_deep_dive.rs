use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;
use crate::pixar::{self, PixarAssets, CharacterConfig, palette};
use crate::asset_loader::CustomAssets;

const COLS: i32 = 10;
const ROWS: i32 = 15;
const TILE: f32 = 40.0;
const ORIGIN_X: f32 = -180.0;
const ORIGIN_Y: f32 = -280.0;
const MOVE_CD: f32 = 0.12;
const SKY_ROWS: i32 = 2;
const MAX_FUEL: i32 = 100;

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

pub fn setup(mut commands: Commands, pixar_assets: Res<PixarAssets>, custom_assets: Res<CustomAssets>) {
    commands.insert_resource(GameState { score: 0, move_cd: 0.0 });

    // Background
    if let Some(ref bg_handle) = custom_assets.background {
        commands.spawn((
            Sprite { image: bg_handle.clone(), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
            Transform::from_xyz(0.0, 0.0, -1.0),
            GameEntity,
        ));
    } else {
        commands.spawn((
            Sprite { color: Color::srgb(0.04, 0.04, 0.08), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
            Transform::from_xyz(0.0, 0.0, -1.0),
            GameEntity,
        ));
    }

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

            let (px, py) = grid_to_world(col, row);

            if kind == TileKind::Sky { continue; } // don't spawn sky tiles

            let tile_size = Vec2::new(TILE - 2.0, TILE - 2.0);
            spawn_tile(&mut commands, &pixar_assets, kind, mineral, tile_size, Vec3::new(px, py, 0.0), col, row);
        }
    }

    // Player (miner) on surface — hero with HERO_ORANGE
    let surface_gy = ROWS - 1 - SKY_ROWS; // top row that is surface
    let (px, py) = grid_to_world(COLS / 2, surface_gy + 1); // stand above surface
    let player_size = Vec2::new(TILE - 8.0, TILE - 8.0);
    let player_config = CharacterConfig::hero(palette::HERO_ORANGE, player_size);
    pixar::spawn_character(
        &mut commands,
        &pixar_assets,
        &player_config,
        Vec3::new(px, py, 1.0),
        (Player { gx: COLS / 2, gy: surface_gy + 1, fuel: MAX_FUEL, cargo_value: 0 }, GameEntity),
    );

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
                commands.entity(e).despawn_recursive();
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

pub fn cleanup(mut commands: Commands, q: Query<Entity, With<GameEntity>>) {
    for e in &q { commands.entity(e).despawn_recursive(); }
    commands.remove_resource::<GameState>();
}

fn grid_to_world(gx: i32, gy: i32) -> (f32, f32) {
    (ORIGIN_X + gx as f32 * TILE, ORIGIN_Y + gy as f32 * TILE)
}

fn spawn_tile(commands: &mut Commands, pixar_assets: &PixarAssets, kind: TileKind, mineral: MineralKind, size: Vec2, position: Vec3, gx: i32, gy: i32) {
    match kind {
        TileKind::Surface => {
            // Surface is a prop with GROUND_GREEN
            let config = CharacterConfig::prop(palette::GROUND_GREEN, size, false);
            pixar::spawn_character(
                commands,
                pixar_assets,
                &config,
                position,
                (Tile { gx, gy, kind, mineral }, GameEntity),
            );
        }
        TileKind::Rock => {
            // Rock is a prop with GROUND_BROWN
            let config = CharacterConfig::prop(palette::GROUND_BROWN, size, false);
            pixar::spawn_character(
                commands,
                pixar_assets,
                &config,
                position,
                (Tile { gx, gy, kind, mineral }, GameEntity),
            );
        }
        TileKind::Dirt => {
            match mineral {
                MineralKind::None => {
                    // Plain dirt — prop with GROUND_BROWN
                    let config = CharacterConfig::prop(palette::GROUND_BROWN, size, false);
                    pixar::spawn_character(
                        commands,
                        pixar_assets,
                        &config,
                        position,
                        (Tile { gx, gy, kind, mineral }, GameEntity),
                    );
                }
                MineralKind::Copper => {
                    // Copper gem — collectible with BRONZE
                    let config = CharacterConfig::collectible(palette::BRONZE, size.x);
                    pixar::spawn_character(
                        commands,
                        pixar_assets,
                        &config,
                        position,
                        (Tile { gx, gy, kind, mineral }, GameEntity),
                    );
                }
                MineralKind::Silver => {
                    // Silver gem — collectible with SILVER
                    let config = CharacterConfig::collectible(palette::SILVER, size.x);
                    pixar::spawn_character(
                        commands,
                        pixar_assets,
                        &config,
                        position,
                        (Tile { gx, gy, kind, mineral }, GameEntity),
                    );
                }
                MineralKind::Gold => {
                    // Gold gem — collectible with GOLD
                    let config = CharacterConfig::collectible(palette::GOLD, size.x);
                    pixar::spawn_character(
                        commands,
                        pixar_assets,
                        &config,
                        position,
                        (Tile { gx, gy, kind, mineral }, GameEntity),
                    );
                }
                MineralKind::Diamond => {
                    // Diamond — collectible with ELECTRIC_CYAN
                    let config = CharacterConfig::collectible(palette::ELECTRIC_CYAN, size.x);
                    pixar::spawn_character(
                        commands,
                        pixar_assets,
                        &config,
                        position,
                        (Tile { gx, gy, kind, mineral }, GameEntity),
                    );
                }
            }
        }
        TileKind::Sky => {} // never reached — skipped in the loop
    }
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
