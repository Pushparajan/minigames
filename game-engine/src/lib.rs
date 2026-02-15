use bevy::prelude::*;
use bevy::window::{PresentMode, WindowPlugin};
use wasm_bindgen::prelude::*;

pub mod asset_loader;
pub mod games;
pub mod pixar;

use games::GamePlugin;

// ---------------------------------------------------------------------------
// App‑wide state machine
// ---------------------------------------------------------------------------

/// Top‑level application state.
///
/// * `Menu`    – idle; waiting for the React shell to call `start_game`.
/// * `Playing` – a game scene is active.
/// * `GameOver`– the last game has ended; score is available via `get_score`.
#[derive(States, Debug, Clone, PartialEq, Eq, Hash, Default)]
pub enum AppState {
    #[default]
    Menu,
    Playing,
    GameOver,
}

// ---------------------------------------------------------------------------
// Resources shared between Bevy and JS
// ---------------------------------------------------------------------------

/// Bridge resource that carries data between the Bevy world and wasm‑bindgen
/// exported functions.  JS can poll `get_score()` or read the JSON returned
/// by `stop_game()`.
#[derive(Resource, Debug, Clone)]
pub struct BevyBridge {
    pub current_score: i32,
    pub game_id: String,
}

impl Default for BevyBridge {
    fn default() -> Self {
        Self {
            current_score: 0,
            game_id: String::new(),
        }
    }
}

/// Resource used to signal which game should be loaded when transitioning
/// to the `Playing` state.
#[derive(Resource, Debug, Clone)]
pub struct PendingGame {
    pub game_id: String,
}

/// Resource used to signal that the game should be stopped from JS.
#[derive(Resource, Debug, Clone)]
pub struct StopGameSignal;

// ---------------------------------------------------------------------------
// Global static holding the Bevy `App` (needed because wasm‑bindgen exports
// are free functions – we cannot pass a &mut App across the FFI boundary).
// ---------------------------------------------------------------------------

use std::sync::Mutex;
static APP: Mutex<Option<App>> = Mutex::new(None);

// ---------------------------------------------------------------------------
// wasm‑bindgen exports
// ---------------------------------------------------------------------------

/// Initialize the Bevy engine, targeting the `<canvas>` element whose DOM id
/// matches `canvas_id` (e.g. `"game-canvas"`).  This builds the `App` but
/// does **not** start a game scene – call `start_game` for that.
#[wasm_bindgen]
pub fn init_engine(canvas_id: &str) {
    // Build the CSS selector from the bare id.
    let selector = format!("#{}", canvas_id);

    let mut app = App::new();

    // -- Plugins --------------------------------------------------------
    app.add_plugins(
        DefaultPlugins
            .set(WindowPlugin {
                primary_window: Some(Window {
                    title: "STEM Minigames".into(),
                    canvas: Some(selector),
                    fit_canvas_to_parent: true,
                    prevent_default_event_handling: false,
                    present_mode: PresentMode::AutoVsync,
                    ..default()
                }),
                ..default()
            })
            // Disable the log plugin's default panic hook so that the
            // browser console stays usable.
            .disable::<bevy::log::LogPlugin>(),
    );

    // -- State ----------------------------------------------------------
    app.init_state::<AppState>();

    // -- Resources ------------------------------------------------------
    app.init_resource::<BevyBridge>();

    // -- Game plugins ---------------------------------------------------
    app.add_plugins(GamePlugin);

    // -- Pixar-style character rendering --------------------------------
    app.add_plugins(pixar::PixarPlugin);

    // -- Runtime asset uploads (sprites, .glb/.gltf) --------------------
    app.add_plugins(asset_loader::AssetLoaderPlugin);

    // -- Startup: spawn a 2‑D camera that persists across states --------
    app.add_systems(Startup, setup_camera);

    // -- System that checks for the StopGameSignal resource -------------
    app.add_systems(Update, handle_stop_signal);

    // Store the app globally so the other exports can reach it.
    // We do NOT call `app.run()` here because Bevy's default runner for
    // WASM will take over the browser's requestAnimationFrame loop.
    // Instead, we call `app.run()` once, and it keeps going.
    *APP.lock().unwrap() = Some(app);

    // Actually start the Bevy render loop.
    if let Some(app) = APP.lock().unwrap().take() {
        // `app.run()` on WASM is non‑blocking; it schedules
        // requestAnimationFrame callbacks internally.
        app.run();
    }
}

/// Load and start the game scene identified by `game_id`.
/// Currently supported: `"campus_dash"`.
#[wasm_bindgen]
pub fn start_game(game_id: &str) {
    // We cannot mutate the App after `run()` from outside.  Instead we
    // insert a resource that a Bevy system will pick up on the next frame.
    // Because `app.run()` has already been called, we use web_sys to
    // communicate via a global JS variable that a Bevy system polls.
    set_js_global("__bevy_pending_game", game_id);
}

/// Stop the current game and return the final score as a JSON string.
/// Example return value: `{"game_id":"campus_dash","score":42}`
#[wasm_bindgen]
pub fn stop_game() -> String {
    set_js_global("__bevy_stop_signal", "true");
    // Return the latest score we can read from the JS globals.
    let score = get_js_global("__bevy_current_score")
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(0);
    let game_id = get_js_global("__bevy_game_id").unwrap_or_default();
    format!("{{\"game_id\":\"{}\",\"score\":{}}}", game_id, score)
}

/// Return the current score of the running game (or 0 if no game is active).
#[wasm_bindgen]
pub fn get_score() -> i32 {
    get_js_global("__bevy_current_score")
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// JS global helpers  (communicate between free‑fn exports and Bevy systems)
// ---------------------------------------------------------------------------

fn set_js_global(key: &str, value: &str) {
    let window = web_sys::window().expect("no global window");
    js_sys::Reflect::set(
        &window,
        &JsValue::from_str(key),
        &JsValue::from_str(value),
    )
    .ok();
}

fn get_js_global(key: &str) -> Option<String> {
    let window = web_sys::window()?;
    let val = js_sys::Reflect::get(&window, &JsValue::from_str(key)).ok()?;
    val.as_string()
}

fn delete_js_global(key: &str) {
    if let Some(window) = web_sys::window() {
        js_sys::Reflect::set(
            &window,
            &JsValue::from_str(key),
            &JsValue::UNDEFINED,
        )
        .ok();
    }
}

// ---------------------------------------------------------------------------
// Bevy systems (run inside the Bevy schedule, have full World access)
// ---------------------------------------------------------------------------

/// Spawn a 2‑D camera once at startup.
fn setup_camera(mut commands: Commands) {
    commands.spawn(Camera2d);
}

/// Every frame, check the JS globals for pending commands from the React
/// shell and translate them into Bevy state transitions / resources.
fn handle_stop_signal(
    mut next_state: ResMut<NextState<AppState>>,
    current_state: Res<State<AppState>>,
    mut bridge: ResMut<BevyBridge>,
) {
    // ---- Check for "start game" signal --------------------------------
    if let Some(game_id) = get_js_global("__bevy_pending_game") {
        if !game_id.is_empty() {
            delete_js_global("__bevy_pending_game");
            bridge.game_id = game_id;
            bridge.current_score = 0;
            next_state.set(AppState::Playing);
        }
    }

    // ---- Check for "stop game" signal ---------------------------------
    if let Some(stop) = get_js_global("__bevy_stop_signal") {
        if stop == "true" {
            delete_js_global("__bevy_stop_signal");
            if *current_state.get() == AppState::Playing {
                next_state.set(AppState::GameOver);
            }
        }
    }

    // ---- Always publish current score to a JS global so `get_score()`
    //      can read it synchronously from any thread. -----------------
    set_js_global(
        "__bevy_current_score",
        &bridge.current_score.to_string(),
    );
    set_js_global("__bevy_game_id", &bridge.game_id);
}
