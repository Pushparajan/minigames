use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;
use crate::pixar::{self, PixarAssets, CharacterConfig, palette};
use crate::asset_loader::CustomAssets;

const COLS: i32 = 6;
const ROWS: i32 = 6;
const TILE: f32 = 64.0;
const ORIGIN_X: f32 = -((COLS as f32) * TILE) / 2.0 + TILE / 2.0;
const ORIGIN_Y: f32 = -((ROWS as f32) * TILE) / 2.0 + TILE / 2.0;

#[derive(Component)]
pub struct GameEntity;

#[derive(Clone, Copy, PartialEq)]
enum PipeType { Straight, Corner, Tjunction, Cross }

#[derive(Clone, Copy, PartialEq)]
enum TileRole { Pipe, Source, Sink }

#[derive(Component)]
struct Pipe {
    pipe_type: PipeType,
    rotation: u8, // 0..3 (x90 degrees)
    gx: i32,
    gy: i32,
    role: TileRole,
    connected: bool,
}

#[derive(Component)]
struct ConnectorVisual { gx: i32, gy: i32 }

#[derive(Component)]
struct ScoreText;

#[derive(Resource)]
struct GameState {
    score: i32,
    won: bool,
}

fn wp(gx: i32, gy: i32, z: f32) -> Vec3 {
    Vec3::new(ORIGIN_X + gx as f32 * TILE, ORIGIN_Y + gy as f32 * TILE, z)
}

fn connections(pipe_type: PipeType, rotation: u8) -> [bool; 4] {
    let base = match pipe_type {
        PipeType::Straight => [true, false, true, false],  // up, down
        PipeType::Corner =>   [true, true, false, false],   // up, right
        PipeType::Tjunction =>[true, true, false, true],    // up, right, left (T)
        PipeType::Cross =>    [true, true, true, true],     // all
    };
    let mut result = base;
    for _ in 0..rotation {
        let tmp = result[0];
        result[0] = result[3];
        result[3] = result[2];
        result[2] = result[1];
        result[1] = tmp;
    }
    result
}

fn pipe_color(connected: bool, role: TileRole) -> Color {
    match role {
        TileRole::Source => palette::ELECTRIC_CYAN,
        TileRole::Sink => palette::VILLAIN_RED,
        TileRole::Pipe => {
            if connected { palette::HERO_GREEN } else { palette::SHADOW }
        }
    }
}

fn compute_connectivity(pipes: &[(i32, i32, PipeType, u8, TileRole)]) -> Vec<bool> {
    let mut connected = vec![false; pipes.len()];
    let source_idx = pipes.iter().position(|p| p.4 == TileRole::Source);
    let Some(si) = source_idx else { return connected; };

    let mut queue = std::collections::VecDeque::new();
    queue.push_back(si);
    connected[si] = true;

    let offsets: [(i32, i32); 4] = [(0, 1), (1, 0), (0, -1), (-1, 0)];
    let opposite: [usize; 4] = [2, 3, 0, 1];

    while let Some(ci) = queue.pop_front() {
        let (cx, cy, ct, cr, _) = pipes[ci];
        let conns = connections(ct, cr);

        for dir in 0..4 {
            if !conns[dir] { continue; }
            let nx = cx + offsets[dir].0;
            let ny = cy + offsets[dir].1;
            if let Some(ni) = pipes.iter().position(|p| p.0 == nx && p.1 == ny) {
                if connected[ni] { continue; }
                let (_, _, nt, nr, _) = pipes[ni];
                let nconns = connections(nt, nr);
                if nconns[opposite[dir]] {
                    connected[ni] = true;
                    queue.push_back(ni);
                }
            }
        }
    }

    connected
}

pub fn setup(mut commands: Commands, pixar_assets: Res<PixarAssets>, custom_assets: Res<CustomAssets>) {
    commands.insert_resource(GameState { score: 0, won: false });

    // Background
    if let Some(ref bg_handle) = custom_assets.background {
        commands.spawn((
            Sprite { image: bg_handle.clone(), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
            Transform::from_xyz(0.0, 0.0, -1.0),
            GameEntity,
        ));
    } else {
        commands.spawn((
            Sprite { color: palette::LAB_BG, custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
            Transform::from_xyz(0.0, 0.0, -1.0),
            GameEntity,
        ));
    }

    let mut rng = rand::thread_rng();
    let pipe_types = [PipeType::Straight, PipeType::Corner, PipeType::Tjunction, PipeType::Cross];

    for gy in 0..ROWS {
        for gx in 0..COLS {
            let role = if gx == 0 && gy == ROWS - 1 {
                TileRole::Source
            } else if gx == COLS - 1 && gy == 0 {
                TileRole::Sink
            } else {
                TileRole::Pipe
            };

            let pipe_type = if role == TileRole::Source || role == TileRole::Sink {
                PipeType::Cross // source/sink connect all directions
            } else {
                pipe_types[rng.gen_range(0..pipe_types.len())]
            };

            let rotation = if role == TileRole::Source || role == TileRole::Sink {
                0
            } else {
                rng.gen_range(0..4)
            };

            // Background tile (prop)
            let bg_config = CharacterConfig::prop(palette::LAB_BG, Vec2::splat(TILE - 2.0), false);
            pixar::spawn_character(&mut commands, &pixar_assets, &bg_config, wp(gx, gy, 0.0), (
                GameEntity,
            ));

            // Pipe visual: center piece as robot
            let color = pipe_color(false, role);
            let conns = connections(pipe_type, rotation);
            let stub_w = TILE * 0.3;
            let stub_l = TILE * 0.45;
            let center_size = TILE * 0.35;

            // Center piece - robot style
            let center_config = CharacterConfig::robot(color, Vec2::splat(center_size));
            pixar::spawn_character(&mut commands, &pixar_assets, &center_config, wp(gx, gy, 0.5), (
                Pipe { pipe_type, rotation, gx, gy, role, connected: false },
                GameEntity,
            ));

            // Stub for each connection direction
            for dir in 0..4 {
                if !conns[dir] { continue; }
                let (ox, oy, w, h) = match dir {
                    0 => (0.0, stub_l / 2.0, stub_w, stub_l),   // up
                    1 => (stub_l / 2.0, 0.0, stub_l, stub_w),   // right
                    2 => (0.0, -stub_l / 2.0, stub_w, stub_l),  // down
                    _ => (-stub_l / 2.0, 0.0, stub_l, stub_w),  // left
                };
                let pos = wp(gx, gy, 0.4);
                commands.spawn((
                    Sprite { color, custom_size: Some(Vec2::new(w, h)), ..default() },
                    Transform::from_xyz(pos.x + ox, pos.y + oy, 0.4),
                    ConnectorVisual { gx, gy },
                    GameEntity,
                ));
            }
        }
    }

    // HUD
    commands.spawn((
        Text::new("Click pipes to rotate | Connect source to sink"),
        TextFont { font_size: 18.0, ..default() },
        TextColor(Color::srgb(0.9, 0.85, 0.3)),
        Node { position_type: PositionType::Absolute, top: Val::Px(8.0), left: Val::Px(8.0), ..default() },
        ScoreText, GameEntity,
    ));
}

pub fn handle_click(
    mouse: Res<ButtonInput<MouseButton>>,
    windows: Query<&Window>,
    camera_q: Query<(&Camera, &GlobalTransform)>,
    mut pq: Query<&mut Pipe>,
    state: Res<GameState>,
) {
    if state.won { return; }
    if !mouse.just_pressed(MouseButton::Left) { return; }

    let Ok(window) = windows.get_single() else { return };
    let Ok((camera, cam_tf)) = camera_q.get_single() else { return };
    let Some(cursor) = window.cursor_position().and_then(|p| camera.viewport_to_world_2d(cam_tf, p).ok()) else { return };

    // Find which grid cell was clicked
    let gx = ((cursor.x - ORIGIN_X + TILE / 2.0) / TILE).floor() as i32;
    let gy = ((cursor.y - ORIGIN_Y + TILE / 2.0) / TILE).floor() as i32;

    for mut pipe in &mut pq {
        if pipe.gx == gx && pipe.gy == gy {
            if pipe.role == TileRole::Source || pipe.role == TileRole::Sink { continue; }
            pipe.rotation = (pipe.rotation + 1) % 4;
        }
    }
}

pub fn update_connectivity(
    mut pq: Query<&mut Pipe>,
    mut state: ResMut<GameState>,
) {
    if state.won { return; }

    let data: Vec<(i32, i32, PipeType, u8, TileRole)> = pq.iter()
        .map(|p| (p.gx, p.gy, p.pipe_type, p.rotation, p.role))
        .collect();

    let connected = compute_connectivity(&data);

    let mut all_data_iter = data.iter().zip(connected.iter());
    for mut pipe in &mut pq {
        // Find matching entry
        if let Some((_d, &c)) = all_data_iter.next() {
            pipe.connected = c;
        }
    }

    // Check if sink is connected
    let sink_connected = pq.iter().any(|p| p.role == TileRole::Sink && p.connected);
    if sink_connected {
        state.won = true;
        state.score += 500;
        // Don't immediately game-over; let user see the green
    }
}

pub fn update_visuals(
    pq: Query<&Pipe>,
    mut center_q: Query<(&Pipe, &mut Sprite), Without<ConnectorVisual>>,
    mut commands: Commands,
    stub_entities: Query<Entity, With<ConnectorVisual>>,
) {
    // Update center colors
    for (pipe, mut sprite) in &mut center_q {
        sprite.color = pipe_color(pipe.connected, pipe.role);
    }

    // Despawn old stubs and recreate (simple approach)
    for e in &stub_entities {
        commands.entity(e).despawn();
    }

    for pipe in &pq {
        let conns = connections(pipe.pipe_type, pipe.rotation);
        let color = pipe_color(pipe.connected, pipe.role);
        let stub_w = TILE * 0.3;
        let stub_l = TILE * 0.45;

        for dir in 0..4 {
            if !conns[dir] { continue; }
            let (ox, oy, w, h) = match dir {
                0 => (0.0, stub_l / 2.0, stub_w, stub_l),
                1 => (stub_l / 2.0, 0.0, stub_l, stub_w),
                2 => (0.0, -stub_l / 2.0, stub_w, stub_l),
                _ => (-stub_l / 2.0, 0.0, stub_l, stub_w),
            };
            let pos = wp(pipe.gx, pipe.gy, 0.4);
            commands.spawn((
                Sprite { color, custom_size: Some(Vec2::new(w, h)), ..default() },
                Transform::from_xyz(pos.x + ox, pos.y + oy, 0.4),
                ConnectorVisual { gx: pipe.gx, gy: pipe.gy },
                GameEntity,
            ));
        }
    }
}

pub fn check_game_over(
    state: Res<GameState>,
    time: Res<Time>,
    mut next_state: ResMut<NextState<crate::AppState>>,
    mut timer: Local<f32>,
) {
    if !state.won {
        *timer = 0.0;
        return;
    }
    *timer += time.delta_secs();
    if *timer > 1.5 {
        next_state.set(crate::AppState::GameOver);
    }
}

pub fn update_score(state: Res<GameState>, mut bridge: ResMut<BevyBridge>) {
    bridge.current_score = state.score;
}

pub fn update_hud(state: Res<GameState>, mut q: Query<&mut Text, With<ScoreText>>) {
    for mut t in &mut q {
        if state.won {
            **t = format!("Connected! +500 | Score: {}", state.score);
        } else {
            **t = format!("Click to rotate pipes | Score: {}", state.score);
        }
    }
}

pub fn cleanup(mut commands: Commands, q: Query<Entity, With<GameEntity>>) {
    for e in &q { commands.entity(e).despawn(); }
    commands.remove_resource::<GameState>();
}
