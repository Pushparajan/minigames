pub mod aero_engineering;
pub mod cable_car_conundrum;
pub mod campus_dash;
pub mod campus_guard;
pub mod chemistry_escape;
pub mod color_lab_quest;
pub mod demo_day;
pub mod drone_defense;
pub mod find_the_principal;
pub mod formula_stem;
pub mod geology_deep_dive;
pub mod gravity_shift_run;
pub mod heavy_gear_delivery;
pub mod lab_breach;
pub mod parkour_lab;
pub mod rover_field_test;
pub mod safety_first_defense;
pub mod stem_celebration;
pub mod history_vault_escape;
pub mod hydro_logic_puzzles;
pub mod logicrons_grid_shift;
pub mod molecular_split;
pub mod physics_master_billiards;
pub mod robot_repair_bay;
pub mod stem_project_volley;

use bevy::prelude::*;

use crate::AppState;

/// Plugin that registers all game systems with the Bevy app.
pub struct GamePlugin;

impl Plugin for GamePlugin {
    fn build(&self, app: &mut App) {
        // -- campus_dash ---------------------------------------------------
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
            .add_systems(OnExit(AppState::Playing), campus_dash::cleanup);

        // -- aero_engineering -----------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), aero_engineering::setup)
            .add_systems(
                Update,
                (
                    aero_engineering::player_input,
                    aero_engineering::move_bullets,
                    aero_engineering::spawn_enemies,
                    aero_engineering::move_enemies,
                    aero_engineering::check_collisions,
                    aero_engineering::update_score,
                    aero_engineering::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), aero_engineering::cleanup);

        // -- campus_guard ---------------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), campus_guard::setup)
            .add_systems(
                Update,
                (
                    campus_guard::player_input,
                    campus_guard::spawn_enemies,
                    campus_guard::move_enemies,
                    campus_guard::turret_fire,
                    campus_guard::move_bullets,
                    campus_guard::bullet_hit,
                    campus_guard::update_score,
                    campus_guard::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), campus_guard::cleanup);

        // -- drone_defense --------------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), drone_defense::setup)
            .add_systems(
                Update,
                (
                    drone_defense::player_input,
                    drone_defense::move_bullets,
                    drone_defense::spawn_enemies,
                    drone_defense::move_enemies,
                    drone_defense::check_collisions,
                    drone_defense::update_fuel_bar,
                    drone_defense::update_score,
                    drone_defense::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), drone_defense::cleanup);

        // -- gravity_shift_run ----------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), gravity_shift_run::setup)
            .add_systems(
                Update,
                (
                    gravity_shift_run::player_input,
                    gravity_shift_run::player_physics,
                    gravity_shift_run::scroll_world,
                    gravity_shift_run::spawn_obstacles,
                    gravity_shift_run::check_collisions,
                    gravity_shift_run::update_score,
                    gravity_shift_run::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), gravity_shift_run::cleanup);

        // -- lab_breach -----------------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), lab_breach::setup)
            .add_systems(
                Update,
                (
                    lab_breach::player_input,
                    lab_breach::player_physics,
                    lab_breach::move_bullets,
                    lab_breach::spawn_enemies,
                    lab_breach::move_enemies,
                    lab_breach::check_collisions,
                    lab_breach::advance_distance,
                    lab_breach::update_score,
                    lab_breach::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), lab_breach::cleanup);

        // -- parkour_lab ----------------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), parkour_lab::setup)
            .add_systems(
                Update,
                (
                    parkour_lab::player_input,
                    parkour_lab::player_physics,
                    parkour_lab::scroll_world,
                    parkour_lab::spawn_obstacles,
                    parkour_lab::check_collisions,
                    parkour_lab::update_score,
                    parkour_lab::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), parkour_lab::cleanup);

        // -- rover_field_test ------------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), rover_field_test::setup)
            .add_systems(
                Update,
                (
                    rover_field_test::rover_input,
                    rover_field_test::move_world,
                    rover_field_test::update_terrain,
                    rover_field_test::rover_follow_terrain,
                    rover_field_test::check_game_over,
                    rover_field_test::update_score,
                    rover_field_test::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), rover_field_test::cleanup);

        // -- heavy_gear_delivery ---------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), heavy_gear_delivery::setup)
            .add_systems(
                Update,
                (
                    heavy_gear_delivery::truck_input,
                    heavy_gear_delivery::move_world,
                    heavy_gear_delivery::update_terrain,
                    heavy_gear_delivery::truck_follow,
                    heavy_gear_delivery::cargo_balance,
                    heavy_gear_delivery::check_game_over,
                    heavy_gear_delivery::update_score,
                    heavy_gear_delivery::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), heavy_gear_delivery::cleanup);

        // -- safety_first_defense --------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), safety_first_defense::setup)
            .add_systems(
                Update,
                (
                    safety_first_defense::player_input,
                    safety_first_defense::spawn_enemies,
                    safety_first_defense::move_enemies,
                    safety_first_defense::move_bullets,
                    safety_first_defense::bullet_collisions,
                    safety_first_defense::enemy_reach_bottom,
                    safety_first_defense::check_game_over,
                    safety_first_defense::update_score,
                    safety_first_defense::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), safety_first_defense::cleanup);

        // -- stem_project_volley ---------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), stem_project_volley::setup)
            .add_systems(
                Update,
                (
                    stem_project_volley::player_fire,
                    stem_project_volley::ai_fire,
                    stem_project_volley::move_projectiles,
                    stem_project_volley::projectile_collisions,
                    stem_project_volley::check_game_over,
                    stem_project_volley::update_score,
                    stem_project_volley::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), stem_project_volley::cleanup);

        // -- stem_celebration ------------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), stem_celebration::setup)
            .add_systems(
                Update,
                (
                    stem_celebration::spawn_notes,
                    stem_celebration::move_notes,
                    stem_celebration::player_input,
                    stem_celebration::missed_notes,
                    stem_celebration::check_game_over,
                    stem_celebration::update_score,
                    stem_celebration::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), stem_celebration::cleanup);

        // -- cable_car_conundrum ---------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), cable_car_conundrum::setup)
            .add_systems(
                Update,
                (
                    cable_car_conundrum::car_input,
                    cable_car_conundrum::move_car,
                    cable_car_conundrum::check_obstacles,
                    cable_car_conundrum::check_collectibles,
                    cable_car_conundrum::check_finish,
                    cable_car_conundrum::update_score,
                    cable_car_conundrum::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), cable_car_conundrum::cleanup);

        // -- chemistry_escape ------------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), chemistry_escape::setup)
            .add_systems(
                Update,
                (
                    chemistry_escape::player_move,
                    chemistry_escape::gravity,
                    chemistry_escape::update_score,
                    chemistry_escape::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), chemistry_escape::cleanup);

        // -- color_lab_quest -------------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), color_lab_quest::setup)
            .add_systems(
                Update,
                (
                    color_lab_quest::player_input,
                    color_lab_quest::physics,
                    color_lab_quest::collect_orbs,
                    color_lab_quest::check_goal,
                    color_lab_quest::update_platform_vis,
                    color_lab_quest::update_score,
                    color_lab_quest::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), color_lab_quest::cleanup);

        // -- demo_day --------------------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), demo_day::setup)
            .add_systems(
                Update,
                (
                    demo_day::place_explosive,
                    demo_day::detonate,
                    demo_day::explosion_vfx,
                    demo_day::gravity_settle,
                    demo_day::update_score,
                    demo_day::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), demo_day::cleanup);

        // -- find_the_principal ----------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), find_the_principal::setup)
            .add_systems(
                Update,
                (
                    find_the_principal::player_move,
                    find_the_principal::gravity,
                    find_the_principal::enemy_patrol,
                    find_the_principal::check_enemy_collision,
                    find_the_principal::update_score,
                    find_the_principal::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), find_the_principal::cleanup);

        // -- formula_stem ----------------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), formula_stem::setup)
            .add_systems(
                Update,
                (
                    formula_stem::player_drive,
                    formula_stem::check_waypoints,
                    formula_stem::ai_drive,
                    formula_stem::update_score,
                    formula_stem::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), formula_stem::cleanup);

        // -- geology_deep_dive -----------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), geology_deep_dive::setup)
            .add_systems(
                Update,
                (
                    geology_deep_dive::player_move,
                    geology_deep_dive::gravity,
                    geology_deep_dive::update_score,
                    geology_deep_dive::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), geology_deep_dive::cleanup);

        // -- history_vault_escape ----------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), history_vault_escape::setup)
            .add_systems(
                Update,
                (
                    history_vault_escape::player_input,
                    history_vault_escape::update_visuals,
                    history_vault_escape::update_score,
                    history_vault_escape::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), history_vault_escape::cleanup);

        // -- hydro_logic_puzzles -----------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), hydro_logic_puzzles::setup)
            .add_systems(
                Update,
                (
                    hydro_logic_puzzles::player_input,
                    hydro_logic_puzzles::apply_gravity,
                    hydro_logic_puzzles::check_win,
                    hydro_logic_puzzles::update_visuals,
                    hydro_logic_puzzles::update_score,
                    hydro_logic_puzzles::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), hydro_logic_puzzles::cleanup);

        // -- logicrons_grid_shift ----------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), logicrons_grid_shift::setup)
            .add_systems(
                Update,
                (
                    logicrons_grid_shift::player_input,
                    logicrons_grid_shift::update_visuals,
                    logicrons_grid_shift::update_score,
                    logicrons_grid_shift::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), logicrons_grid_shift::cleanup);

        // -- molecular_split ---------------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), molecular_split::setup)
            .add_systems(
                Update,
                (
                    molecular_split::player_input,
                    molecular_split::move_harpoon,
                    molecular_split::move_molecules,
                    molecular_split::check_harpoon_hit,
                    molecular_split::check_player_hit,
                    molecular_split::check_level_clear,
                    molecular_split::update_score,
                    molecular_split::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), molecular_split::cleanup);

        // -- physics_master_billiards ------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), physics_master_billiards::setup)
            .add_systems(
                Update,
                (
                    physics_master_billiards::handle_input,
                    physics_master_billiards::update_power_line,
                    physics_master_billiards::physics,
                    physics_master_billiards::ball_collisions,
                    physics_master_billiards::check_pockets,
                    physics_master_billiards::update_score,
                    physics_master_billiards::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), physics_master_billiards::cleanup);

        // -- robot_repair_bay --------------------------------------------------
        app.add_systems(OnEnter(AppState::Playing), robot_repair_bay::setup)
            .add_systems(
                Update,
                (
                    robot_repair_bay::handle_click,
                    robot_repair_bay::update_connectivity,
                    robot_repair_bay::update_visuals,
                    robot_repair_bay::check_game_over,
                    robot_repair_bay::update_score,
                    robot_repair_bay::update_hud,
                )
                    .run_if(in_state(AppState::Playing)),
            )
            .add_systems(OnExit(AppState::Playing), robot_repair_bay::cleanup);

        // -- Game over UI ---------------------------------------------------
        app.add_systems(OnEnter(AppState::GameOver), on_game_over)
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
