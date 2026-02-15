use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLS: i32 = 12;
const ROWS: i32 = 8;
const TILE: f32 = 50.0;
const ORIGIN_X: f32 = -275.0;
const ORIGIN_Y: f32 = -175.0;
const GRAVITY_TICK: f32 = 0.10;
const MOVE_CD: f32 = 0.13;
const ENEMY_TICK: f32 = 0.4;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

#[derive(Component)]
pub struct GameEntity;

#[derive(Component)]
struct Player {
    gx: i32,
    gy: i32,
    lives: i32,
    on_ladder: bool,
}

#[derive(Component)]
struct Enemy {
    gx: i32,
    gy: i32,
    dir: i32, // -1 or 1
}

#[derive(Clone, Copy, PartialEq)]
enum TileKind { Floor, Ladder, Goal }

#[derive(Component)]
struct Tile { gx: i32, gy: i32, kind: TileKind }

#[derive(Component)]
struct ScoreText;

#[derive(Resource)]
struct GameState {
    score: i32,
    move_cd: f32,
    gravity_timer: f32,
    enemy_timer: f32,
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

pub fn setup(mut commands: Commands) {
    commands.insert_resource(GameState {
        score: 0, move_cd: 0.0, gravity_timer: 0.0, enemy_timer: 0.0,
    });

    // Background
    commands.spawn((
        Sprite { color: Color::srgb(0.05, 0.05, 0.12), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
        Transform::from_xyz(0.0, 0.0, -1.0),
        GameEntity,
    ));

    // Build level
    let level = build_level();
    for row in 0..ROWS {
        for col in 0..COLS {
            let kind = level[row as usize][col as usize];
            if kind.is_none() { continue; }
            let k = kind.unwrap();
            let color = match k {
                TileKind::Floor => Color::srgb(0.3, 0.25, 0.2),
                TileKind::Ladder => Color::srgb(0.6, 0.5, 0.1),
                TileKind::Goal => Color::srgb(0.9, 0.1, 0.5),
            };
            let (px, py) = grid_to_world(col, row);
            commands.spawn((
                Sprite { color, custom_size: Some(Vec2::new(TILE - 2.0, TILE - 2.0)), ..default() },
                Transform::from_xyz(px, py, 0.0),
                Tile { gx: col, gy: row, kind: k },
                GameEntity,
            ));
        }
    }

    // Enemies
    let enemies = [(3, 1, 1), (7, 3, -1), (5, 5, 1)];
    for (gx, gy, dir) in enemies {
        let (px, py) = grid_to_world(gx, gy);
        commands.spawn((
            Sprite { color: Color::srgb(0.9, 0.2, 0.1), custom_size: Some(Vec2::new(TILE - 12.0, TILE - 8.0)), ..default() },
            Transform::from_xyz(px, py, 0.8),
            Enemy { gx, gy, dir },
            GameEntity,
        ));
    }

    // Player at (1,1)
    let (px, py) = grid_to_world(1, 1);
    commands.spawn((
        Sprite { color: Color::srgb(0.2, 0.5, 1.0), custom_size: Some(Vec2::new(TILE - 12.0, TILE - 6.0)), ..default() },
        Transform::from_xyz(px, py, 1.0),
        Player { gx: 1, gy: 1, lives: 3, on_ladder: false },
        GameEntity,
    ));

    // HUD
    commands.spawn((
        Text::new("Lives: 3 | Score: 0"),
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
    tiles: Query<&Tile>,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    state.move_cd -= time.delta_secs();
    if state.move_cd > 0.0 { return; }
    let Ok((mut ptf, mut player)) = pq.get_single_mut() else { return };

    let (mut dx, mut dy) = (0i32, 0i32);
    if keys.pressed(KeyCode::ArrowLeft) { dx = -1; }
    else if keys.pressed(KeyCode::ArrowRight) { dx = 1; }
    else if keys.pressed(KeyCode::ArrowUp) { dy = 1; }
    else if keys.pressed(KeyCode::ArrowDown) { dy = -1; }

    if dx == 0 && dy == 0 { return; }

    // Check if on ladder
    let on_ladder = tiles.iter().any(|t| t.gx == player.gx && t.gy == player.gy && t.kind == TileKind::Ladder);
    player.on_ladder = on_ladder;

    // Vertical movement only on ladder (or jump up)
    if dy != 0 && !on_ladder && dy > 0 {
        // Jump: check not blocked above
        let above_blocked = tiles.iter().any(|t| t.gx == player.gx && t.gy == player.gy + 1 && t.kind == TileKind::Floor);
        if above_blocked { return; }
        dy = 1; // jump one tile
    } else if dy != 0 && !on_ladder {
        return;
    }

    let nx = player.gx + dx;
    let ny = player.gy + dy;
    if nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS { return; }

    // Block if floor tile at destination (horizontal only)
    if dx != 0 {
        let blocked = tiles.iter().any(|t| t.gx == nx && t.gy == ny && t.kind == TileKind::Floor);
        if blocked { return; }
    }

    player.gx = nx;
    player.gy = ny;
    let (wx, wy) = grid_to_world(nx, ny);
    ptf.translation.x = wx;
    ptf.translation.y = wy;
    state.move_cd = MOVE_CD;

    // Check goal
    for t in &tiles {
        if t.gx == nx && t.gy == ny && t.kind == TileKind::Goal {
            state.score += 500;
            next_state.set(crate::AppState::GameOver);
        }
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

    // Don't fall on ladder
    let on_ladder = tiles.iter().any(|t| t.gx == player.gx && t.gy == player.gy && t.kind == TileKind::Ladder);
    if on_ladder { return; }

    let below = player.gy - 1;
    let supported = tiles.iter().any(|t| t.gx == player.gx && t.gy == below && t.kind == TileKind::Floor);
    if !supported {
        player.gy = below;
        let (wx, wy) = grid_to_world(player.gx, player.gy);
        ptf.translation.x = wx;
        ptf.translation.y = wy;
    }
}

pub fn enemy_patrol(
    time: Res<Time>,
    mut state: ResMut<GameState>,
    mut enemies: Query<(&mut Transform, &mut Enemy)>,
    tiles: Query<&Tile>,
) {
    state.enemy_timer += time.delta_secs();
    if state.enemy_timer < ENEMY_TICK { return; }
    state.enemy_timer = 0.0;

    for (mut tf, mut enemy) in &mut enemies {
        let nx = enemy.gx + enemy.dir;
        // Bounce at edges or walls
        let blocked = nx < 0 || nx >= COLS
            || tiles.iter().any(|t| t.gx == nx && t.gy == enemy.gy && t.kind == TileKind::Floor);
        // Also check floor below next pos
        let no_floor = enemy.gy > 0 && !tiles.iter().any(|t| t.gx == nx && t.gy == enemy.gy - 1 && t.kind == TileKind::Floor);

        if blocked || no_floor {
            enemy.dir = -enemy.dir;
        } else {
            enemy.gx = nx;
            let (px, py) = grid_to_world(enemy.gx, enemy.gy);
            tf.translation.x = px;
            tf.translation.y = py;
        }
    }
}

pub fn check_enemy_collision(
    mut commands: Commands,
    mut state: ResMut<GameState>,
    mut pq: Query<(&Transform, &mut Player)>,
    enemies: Query<(Entity, &Enemy, &Transform), Without<Player>>,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    let Ok((ptf, mut player)) = pq.get_single_mut() else { return };
    for (e, enemy, _etf) in &enemies {
        if player.gx == enemy.gx && player.gy == enemy.gy {
            // Stomp not possible at same level — damage
            player.lives -= 1;
            commands.entity(e).despawn();
            if player.lives <= 0 {
                next_state.set(crate::AppState::GameOver);
                return;
            }
        } else if player.gx == enemy.gx && player.gy == enemy.gy + 1 {
            // Stomping from above
            state.score += 100;
            commands.entity(e).despawn();
        }
    }
}

pub fn update_score(state: Res<GameState>, mut bridge: ResMut<BevyBridge>) {
    bridge.current_score = state.score;
}

pub fn update_hud(state: Res<GameState>, pq: Query<&Player>, mut sq: Query<&mut Text, With<ScoreText>>) {
    let Ok(player) = pq.get_single() else { return };
    for mut t in &mut sq {
        **t = format!("Lives: {} | Score: {}", player.lives, state.score);
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

fn build_level() -> Vec<Vec<Option<TileKind>>> {
    use TileKind::*;
    let f = Some(Floor); let l = Some(Ladder); let g = Some(Goal); let n = None;
    // row 0 = bottom, row 7 = top
    vec![
        vec![f, f, f, f, f, f, f, f, f, f, f, f], // 0: ground
        vec![n, n, n, n, n, n, n, n, n, n, n, n], // 1: open
        vec![f, f, f, f, f, l, n, n, n, n, n, n], // 2: platform + ladder
        vec![n, n, n, n, n, l, n, n, n, n, n, n], // 3: ladder continues
        vec![n, n, n, n, n, l, f, f, f, f, l, f], // 4: platform + ladder
        vec![n, n, n, n, n, n, n, n, n, n, l, n], // 5: open + ladder
        vec![f, f, f, l, f, f, f, f, n, n, l, n], // 6: platform + ladder
        vec![n, n, n, l, n, n, n, n, n, n, n, g], // 7: goal
    ]
}
