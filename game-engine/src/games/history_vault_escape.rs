use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLS: i32 = 10;
const ROWS: i32 = 8;
const TILE: f32 = 48.0;
const ORIGIN_X: f32 = -((COLS as f32) * TILE) / 2.0 + TILE / 2.0;
const ORIGIN_Y: f32 = -((ROWS as f32) * TILE) / 2.0 + TILE / 2.0;

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
    Trap(usize),  // index for deactivation
    Switch(usize),
    Block,
    Exit,
}

#[derive(Component)]
struct Tile {
    kind: TileKind,
    gx: i32,
    gy: i32,
    active: bool,
}

#[derive(Resource)]
struct GameState {
    score: i32,
    move_cooldown: f32,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn world_pos(gx: i32, gy: i32) -> Vec3 {
    Vec3::new(
        ORIGIN_X + gx as f32 * TILE,
        ORIGIN_Y + gy as f32 * TILE,
        0.0,
    )
}

fn tile_color(kind: TileKind, active: bool) -> Color {
    match kind {
        TileKind::Wall => Color::srgb(0.25, 0.25, 0.3),
        TileKind::Floor => Color::srgb(0.15, 0.15, 0.18),
        TileKind::Key(0) => Color::srgb(1.0, 0.3, 0.3),
        TileKind::Key(1) => Color::srgb(0.3, 1.0, 0.3),
        TileKind::Key(_) => Color::srgb(0.3, 0.3, 1.0),
        TileKind::Door(0) => Color::srgb(0.6, 0.15, 0.15),
        TileKind::Door(1) => Color::srgb(0.15, 0.6, 0.15),
        TileKind::Door(_) => Color::srgb(0.15, 0.15, 0.6),
        TileKind::Trap(_) => {
            if active { Color::srgb(1.0, 0.1, 0.6) } else { Color::srgb(0.2, 0.2, 0.2) }
        }
        TileKind::Switch(_) => Color::srgb(1.0, 1.0, 0.2),
        TileKind::Block => Color::srgb(0.55, 0.4, 0.2),
        TileKind::Exit => Color::srgb(0.0, 1.0, 0.8),
    }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

pub fn setup(mut commands: Commands) {
    commands.insert_resource(GameState { score: 0, move_cooldown: 0.0 });

    // Background
    commands.spawn((
        Sprite { color: Color::srgb(0.05, 0.05, 0.1), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
        Transform::from_xyz(0.0, 0.0, -1.0),
        GameEntity,
    ));

    // Build level layout
    #[rustfmt::skip]
    let layout: Vec<(i32, i32, TileKind)> = build_level();

    for (gx, gy, kind) in &layout {
        commands.spawn((
            Sprite { color: tile_color(*kind, true), custom_size: Some(Vec2::splat(TILE - 2.0)), ..default() },
            Transform::from_translation(world_pos(*gx, *gy)),
            Tile { kind: *kind, gx: *gx, gy: *gy, active: true },
            GameEntity,
        ));
    }

    // Player
    commands.spawn((
        Sprite { color: Color::srgb(0.2, 0.6, 1.0), custom_size: Some(Vec2::splat(TILE - 8.0)), ..default() },
        Transform::from_translation(world_pos(1, 1) + Vec3::Z),
        Player { gx: 1, gy: 1, keys: [false; 3] },
        GameEntity,
    ));

    // HUD
    commands.spawn((
        Text::new("Keys: --- | Move with arrows"),
        TextFont { font_size: 20.0, ..default() },
        TextColor(Color::srgb(0.9, 0.85, 0.3)),
        Node { position_type: PositionType::Absolute, top: Val::Px(8.0), left: Val::Px(8.0), ..default() },
        ScoreText,
        GameEntity,
    ));
}

fn build_level() -> Vec<(i32, i32, TileKind)> {
    let mut tiles = Vec::new();
    for y in 0..ROWS {
        for x in 0..COLS {
            let is_border = x == 0 || y == 0 || x == COLS - 1 || y == ROWS - 1;
            let kind = if is_border { TileKind::Wall } else { TileKind::Floor };
            tiles.push((x, y, kind));
        }
    }
    // Internal walls
    for &(x, y) in &[(3,1),(3,2),(3,3),(5,4),(5,5),(5,6),(7,2),(7,3)] {
        if let Some(t) = tiles.iter_mut().find(|(tx,ty,_)| *tx == x && *ty == y) {
            t.2 = TileKind::Wall;
        }
    }
    // Keys
    for &(x, y, i) in &[(2, 6, 0usize), (8, 2, 1), (4, 5, 2)] {
        if let Some(t) = tiles.iter_mut().find(|(tx,ty,_)| *tx == x && *ty == y) {
            t.2 = TileKind::Key(i);
        }
    }
    // Doors
    for &(x, y, i) in &[(6, 3, 0usize), (4, 2, 1), (8, 5, 2)] {
        if let Some(t) = tiles.iter_mut().find(|(tx,ty,_)| *tx == x && *ty == y) {
            t.2 = TileKind::Door(i);
        }
    }
    // Traps
    for &(x, y, i) in &[(2, 3, 0usize), (6, 6, 1)] {
        if let Some(t) = tiles.iter_mut().find(|(tx,ty,_)| *tx == x && *ty == y) {
            t.2 = TileKind::Trap(i);
        }
    }
    // Switches
    for &(x, y, i) in &[(1, 5, 0usize), (8, 1, 1)] {
        if let Some(t) = tiles.iter_mut().find(|(tx,ty,_)| *tx == x && *ty == y) {
            t.2 = TileKind::Switch(i);
        }
    }
    // Block
    if let Some(t) = tiles.iter_mut().find(|(tx,ty,_)| *tx == 4 && *ty == 3) {
        t.2 = TileKind::Block;
    }
    // Exit
    if let Some(t) = tiles.iter_mut().find(|(tx,ty,_)| *tx == 8 && *ty == 6) {
        t.2 = TileKind::Exit;
    }
    tiles
}

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

pub fn player_input(
    keys: Res<ButtonInput<KeyCode>>,
    time: Res<Time>,
    mut state: ResMut<GameState>,
    mut pq: Query<(&mut Player, &mut Transform)>,
    mut tq: Query<(&mut Tile, &mut Sprite, Entity)>,
    mut commands: Commands,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    state.move_cooldown -= time.delta_secs();
    if state.move_cooldown > 0.0 { return; }

    let (dx, dy) = if keys.just_pressed(KeyCode::ArrowUp) { (0, 1) }
        else if keys.just_pressed(KeyCode::ArrowDown) { (0, -1) }
        else if keys.just_pressed(KeyCode::ArrowLeft) { (-1, 0) }
        else if keys.just_pressed(KeyCode::ArrowRight) { (1, 0) }
        else { return; };

    let Ok((mut player, mut ptf)) = pq.get_single_mut() else { return };
    let nx = player.gx + dx;
    let ny = player.gy + dy;

    // Find tile at target
    let target = tq.iter().find(|(t, _, _)| t.gx == nx && t.gy == ny).map(|(t, _, _)| (t.kind, t.active));
    let Some((kind, active)) = target else { return; };

    match kind {
        TileKind::Wall => return,
        TileKind::Door(i) => { if !player.keys[i] { return; } }
        TileKind::Block => {
            let bx = nx + dx;
            let by = ny + dy;
            // Check space behind block
            let behind = tq.iter().find(|(t, _, _)| t.gx == bx && t.gy == by).map(|(t, _, _)| t.kind);
            match behind {
                Some(TileKind::Floor) => {
                    // Push block
                    for (mut t, mut s, _) in &mut tq {
                        if t.gx == nx && t.gy == ny && t.kind == TileKind::Block {
                            t.gx = bx;
                            t.gy = by;
                        }
                    }
                }
                _ => return,
            }
        }
        _ => {}
    }

    // Move player
    player.gx = nx;
    player.gy = ny;
    state.move_cooldown = 0.15;

    // Process tile effects
    match kind {
        TileKind::Key(i) => {
            player.keys[i] = true;
            for (mut t, mut s, _) in &mut tq {
                if t.gx == nx && t.gy == ny && matches!(t.kind, TileKind::Key(_)) {
                    t.kind = TileKind::Floor;
                    s.color = tile_color(TileKind::Floor, true);
                }
            }
        }
        TileKind::Trap(_) if active => {
            next_state.set(crate::AppState::GameOver);
            return;
        }
        TileKind::Switch(i) => {
            for (mut t, mut s, _) in &mut tq {
                if matches!(t.kind, TileKind::Trap(ti) if ti == i) {
                    t.active = false;
                    s.color = tile_color(t.kind, false);
                }
            }
        }
        TileKind::Exit => {
            state.score += 500;
            next_state.set(crate::AppState::GameOver);
        }
        _ => {}
    }
}

pub fn update_visuals(
    pq: Query<&Player>,
    mut tq: Query<(&Tile, &mut Transform), Without<Player>>,
    mut ptf_q: Query<&mut Transform, With<Player>>,
) {
    let Ok(player) = pq.get_single() else { return };
    if let Ok(mut ptf) = ptf_q.get_single_mut() {
        let pos = world_pos(player.gx, player.gy);
        ptf.translation.x = pos.x;
        ptf.translation.y = pos.y;
    }
    for (tile, mut tf) in &mut tq {
        let pos = world_pos(tile.gx, tile.gy);
        tf.translation.x = pos.x;
        tf.translation.y = pos.y;
    }
}

pub fn update_score(state: Res<GameState>, mut bridge: ResMut<BevyBridge>) {
    bridge.current_score = state.score;
}

pub fn update_hud(pq: Query<&Player>, mut q: Query<&mut Text, With<ScoreText>>) {
    let Ok(player) = pq.get_single() else { return };
    let r = if player.keys[0] { "R" } else { "-" };
    let g = if player.keys[1] { "G" } else { "-" };
    let b = if player.keys[2] { "B" } else { "-" };
    for mut t in &mut q {
        **t = format!("Keys: {}{}{} | Arrows to move", r, g, b);
    }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

pub fn cleanup(mut commands: Commands, q: Query<Entity, With<GameEntity>>) {
    for e in &q { commands.entity(e).despawn(); }
    commands.remove_resource::<GameState>();
}
