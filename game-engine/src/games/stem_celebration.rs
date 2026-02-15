use bevy::prelude::*;
use rand::Rng;

use crate::BevyBridge;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LANE_COUNT: usize = 4;
const LANE_SPACING: f32 = 80.0;
const LANE_START_X: f32 = -120.0;
const HIT_LINE_Y: f32 = -230.0;
const SPAWN_Y: f32 = 320.0;
const NOTE_SIZE: Vec2 = Vec2::new(50.0, 20.0);
const BASE_SPEED: f32 = 200.0;
const SPEED_INCREASE: f32 = 3.0;
const PERFECT_DIST: f32 = 15.0;
const GREAT_DIST: f32 = 30.0;
const OK_DIST: f32 = 45.0;
const MAX_MISSES: i32 = 10;
const BASE_INTERVAL: f32 = 0.5;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

#[derive(Component)]
pub struct GameEntity;

#[derive(Component)]
struct Note {
    lane: usize,
}

#[derive(Component)]
struct HitLine;

#[derive(Component)]
struct LaneIndicator {
    lane: usize,
}

#[derive(Component)]
struct ComboText;

#[derive(Component)]
struct ScoreText;

#[derive(Resource)]
struct GameState {
    score: i32,
    combo: i32,
    misses: i32,
    spawn_timer: f32,
    speed: f32,
    elapsed: f32,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn lane_x(lane: usize) -> f32 {
    LANE_START_X + (lane as f32) * LANE_SPACING
}

const LANE_COLORS: [Color; 4] = [
    Color::srgb(0.9, 0.3, 0.3),
    Color::srgb(0.3, 0.9, 0.3),
    Color::srgb(0.3, 0.3, 0.9),
    Color::srgb(0.9, 0.9, 0.3),
];

const LANE_KEYS: [KeyCode; 4] = [
    KeyCode::ArrowLeft,
    KeyCode::ArrowDown,
    KeyCode::ArrowUp,
    KeyCode::ArrowRight,
];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

pub fn setup(mut commands: Commands) {
    commands.insert_resource(GameState {
        score: 0, combo: 0, misses: 0,
        spawn_timer: 0.0, speed: BASE_SPEED, elapsed: 0.0,
    });

    // Background
    commands.spawn((
        Sprite { color: Color::srgb(0.05, 0.04, 0.1), custom_size: Some(Vec2::new(960.0, 640.0)), ..default() },
        Transform::from_xyz(0.0, 0.0, -1.0), GameEntity,
    ));

    // Hit line
    commands.spawn((
        Sprite { color: Color::srgba(1.0, 1.0, 1.0, 0.4), custom_size: Some(Vec2::new(LANE_COUNT as f32 * LANE_SPACING + 40.0, 4.0)), ..default() },
        Transform::from_xyz(LANE_START_X + (LANE_COUNT as f32 - 1.0) * LANE_SPACING / 2.0, HIT_LINE_Y, 0.5),
        HitLine, GameEntity,
    ));

    // Lane indicators at hit line
    for lane in 0..LANE_COUNT {
        commands.spawn((
            Sprite { color: LANE_COLORS[lane].with_alpha(0.3), custom_size: Some(Vec2::new(54.0, 24.0)), ..default() },
            Transform::from_xyz(lane_x(lane), HIT_LINE_Y, 0.4),
            LaneIndicator { lane }, GameEntity,
        ));
    }

    // Combo text
    commands.spawn((
        Text::new("Combo: 0"),
        TextFont { font_size: 28.0, ..default() },
        TextColor(Color::srgb(1.0, 0.6, 0.1)),
        Node { position_type: PositionType::Absolute, top: Val::Px(10.0), right: Val::Px(10.0), ..default() },
        ComboText, GameEntity,
    ));

    // Score text
    commands.spawn((
        Text::new("Score: 0 | Misses: 0/10"),
        TextFont { font_size: 20.0, ..default() },
        TextColor(Color::srgb(0.9, 0.9, 0.3)),
        Node { position_type: PositionType::Absolute, top: Val::Px(10.0), left: Val::Px(10.0), ..default() },
        ScoreText, GameEntity,
    ));
}

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

pub fn spawn_notes(time: Res<Time>, mut state: ResMut<GameState>, mut commands: Commands) {
    let dt = time.delta_secs();
    state.elapsed += dt;
    state.speed = BASE_SPEED + state.elapsed * SPEED_INCREASE;
    let interval = (BASE_INTERVAL - state.elapsed * 0.003).max(0.2);
    state.spawn_timer += dt;
    if state.spawn_timer >= interval {
        state.spawn_timer = 0.0;
        let lane = rand::thread_rng().gen_range(0..LANE_COUNT);
        commands.spawn((
            Sprite { color: LANE_COLORS[lane], custom_size: Some(NOTE_SIZE), ..default() },
            Transform::from_xyz(lane_x(lane), SPAWN_Y, 1.0),
            Note { lane }, GameEntity,
        ));
    }
}

pub fn move_notes(time: Res<Time>, state: Res<GameState>, mut q: Query<&mut Transform, With<Note>>) {
    let dt = time.delta_secs();
    for mut tf in &mut q {
        tf.translation.y -= state.speed * dt;
    }
}

pub fn player_input(
    keys: Res<ButtonInput<KeyCode>>,
    mut commands: Commands,
    mut state: ResMut<GameState>,
    note_q: Query<(Entity, &Transform, &Note)>,
) {
    for (lane_idx, &key) in LANE_KEYS.iter().enumerate() {
        if !keys.just_pressed(key) { continue; }

        // Find closest note in this lane near the hit line
        let mut best: Option<(Entity, f32)> = None;
        for (e, tf, note) in &note_q {
            if note.lane != lane_idx { continue; }
            let dist = (tf.translation.y - HIT_LINE_Y).abs();
            if dist < OK_DIST {
                if best.is_none() || dist < best.unwrap().1 {
                    best = Some((e, dist));
                }
            }
        }

        if let Some((entity, dist)) = best {
            let (points, _label) = if dist <= PERFECT_DIST {
                (100, "PERFECT")
            } else if dist <= GREAT_DIST {
                (50, "GREAT")
            } else {
                (25, "OK")
            };
            let multiplier = 1.0 + (state.combo as f32) / 10.0;
            state.score += (points as f32 * multiplier) as i32;
            state.combo += 1;
            commands.entity(entity).despawn();
        } else {
            state.combo = 0;
            state.misses += 1;
        }
    }
}

pub fn missed_notes(
    mut commands: Commands,
    mut state: ResMut<GameState>,
    note_q: Query<(Entity, &Transform), With<Note>>,
) {
    for (e, tf) in &note_q {
        if tf.translation.y < HIT_LINE_Y - OK_DIST - 20.0 {
            commands.entity(e).despawn();
            state.combo = 0;
            state.misses += 1;
        }
    }
}

pub fn check_game_over(
    state: Res<GameState>,
    mut next_state: ResMut<NextState<crate::AppState>>,
) {
    if state.misses >= MAX_MISSES {
        next_state.set(crate::AppState::GameOver);
    }
}

pub fn update_score(state: Res<GameState>, mut bridge: ResMut<BevyBridge>) {
    bridge.current_score = state.score;
}

pub fn update_hud(
    state: Res<GameState>,
    mut combo_q: Query<&mut Text, (With<ComboText>, Without<ScoreText>)>,
    mut score_q: Query<&mut Text, (With<ScoreText>, Without<ComboText>)>,
) {
    for mut t in &mut combo_q {
        **t = format!("Combo: {}", state.combo);
    }
    for mut t in &mut score_q {
        **t = format!("Score: {} | Misses: {}/{}", state.score, state.misses, MAX_MISSES);
    }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

pub fn cleanup(mut commands: Commands, q: Query<Entity, With<GameEntity>>) {
    for e in &q { commands.entity(e).despawn(); }
    commands.remove_resource::<GameState>();
}
