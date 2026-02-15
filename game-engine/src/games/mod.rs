pub mod campus_dash;

use bevy::prelude::*;

use crate::AppState;

/// Plugin that registers all game systems with the Bevy app.
pub struct GamePlugin;

impl Plugin for GamePlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(OnEnter(AppState::Playing), campus_dash::setup)
            .add_systems(
                Update,
                (
                    campus_dash::player_input,
                    campus_dash::player_physics,
                    campus_dash::scroll_world,
                    campus_dash::spawn_obstacles,
                    campus_dash::check_collisions,
                    campus_dash::update_score,
                    campus_dash::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), campus_dash::cleanup)
            .add_systems(OnEnter(AppState::GameOver), on_game_over)
            .add_systems(OnExit(AppState::GameOver), cleanup_game_over);
    }
}

/// Marker for GameOver UI so we can despawn it on exit.
#[derive(Component)]
struct GameOverUI;

fn on_game_over(mut commands: Commands, bridge: Res<crate::BevyBridge>) {
    commands.spawn((
        Text::new(format!("GAME OVER\nScore: {}", bridge.current_score)),
        TextFont {
            font_size: 48.0,
            ..default()
        },
        TextColor(Color::srgb(0.9, 0.2, 0.2)),
        TextLayout::new_with_justify(JustifyText::Center),
        Node {
            position_type: PositionType::Absolute,
            top: Val::Percent(35.0),
            width: Val::Percent(100.0),
            justify_content: JustifyContent::Center,
            ..default()
        },
        GameOverUI,
    ));
}

fn cleanup_game_over(mut commands: Commands, q: Query<Entity, With<GameOverUI>>) {
    for e in &q {
        commands.entity(e).despawn();
    }
}
