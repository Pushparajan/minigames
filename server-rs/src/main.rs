use axum::{
    middleware as axum_mw,
    routing::{get, post, put},
    Router,
};
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::compression::CompressionLayer;

mod cache;
mod config;
mod db;
mod error;
mod middleware;
mod models;
mod routes;
mod services;

use cache::Cache;
use config::Config;
use middleware::rate_limit::RateLimiter;
use services::room_manager::RoomManager;
use services::stripe_service::StripeClient;

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub cache: Cache,
    pub config: Arc<Config>,
    pub stripe: Option<StripeClient>,
    pub rate_limiter: RateLimiter,
    pub score_rate_limiter: RateLimiter,
    pub room_manager: RoomManager,
}

fn build_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // --- Auth routes (no auth required) ---
    let auth_routes = Router::new()
        .route("/guest", post(routes::auth::guest))
        .route("/register", post(routes::auth::register))
        .route("/login", post(routes::auth::login))
        .route("/refresh", post(routes::auth::refresh));

    // --- Webhook routes (raw body, no auth) ---
    let webhook_routes = Router::new()
        .route("/stripe", post(routes::webhooks::stripe_webhook));

    // --- Authenticated routes ---
    let score_routes = Router::new()
        .route(
            "/:gameId",
            post(routes::scores::submit_score)
                .layer(axum_mw::from_fn_with_state(
                    state.clone(),
                    middleware::rate_limit::score_rate_limit,
                ))
                .get(routes::scores::get_progress),
        )
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            middleware::auth::authenticate,
        ));

    let leaderboard_routes = Router::new()
        .route("/:gameId", get(routes::leaderboards::get_game_leaderboard))
        .route("/:gameId/me", get(routes::leaderboards::get_my_rank))
        .route(
            "/:gameId/around",
            get(routes::leaderboards::get_around_me),
        )
        .route("/global", get(routes::leaderboards::get_global_leaderboard))
        .route(
            "/:gameId/friends",
            get(routes::leaderboards::get_friends_leaderboard),
        )
        .route(
            "/:gameId/ranked",
            get(routes::leaderboards::get_ranked_leaderboard),
        )
        .route("/seasons", get(routes::leaderboards::get_seasons))
        .route(
            "/seasons/current",
            get(routes::leaderboards::get_current_season),
        )
        .route(
            "/submit-match",
            post(routes::leaderboards::submit_match),
        )
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            middleware::auth::optional_auth,
        ));

    let player_routes = Router::new()
        .route(
            "/profile",
            get(routes::player::get_profile).put(routes::player::update_profile),
        )
        .route("/progress", get(routes::player::get_all_progress))
        .route("/achievements", get(routes::player::get_achievements))
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            middleware::auth::authenticate,
        ));

    let sync_routes = Router::new()
        .route("/batch", post(routes::sync::batch_sync))
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            middleware::auth::authenticate,
        ));

    let comment_routes = Router::new()
        .route("/:gameId", get(routes::comments::list_comments))
        .route(
            "/:gameId/thread/:commentId",
            get(routes::comments::get_thread),
        )
        .route(
            "/:gameId",
            post(routes::comments::post_comment)
                .layer(axum_mw::from_fn_with_state(
                    state.clone(),
                    middleware::auth::authenticate,
                )),
        )
        .route(
            "/:commentId",
            put(routes::comments::edit_comment)
                .delete(routes::comments::delete_comment)
                .layer(axum_mw::from_fn_with_state(
                    state.clone(),
                    middleware::auth::authenticate,
                )),
        )
        .route(
            "/:commentId/report",
            post(routes::comments::report_comment)
                .layer(axum_mw::from_fn_with_state(
                    state.clone(),
                    middleware::auth::authenticate,
                )),
        )
        .route("/:gameId/reviews", get(routes::comments::list_reviews))
        .route(
            "/:gameId/reviews",
            post(routes::comments::post_review)
                .delete(routes::comments::delete_review)
                .layer(axum_mw::from_fn_with_state(
                    state.clone(),
                    middleware::auth::authenticate,
                )),
        )
        .route(
            "/reviews/:reviewId/report",
            post(routes::comments::report_review)
                .layer(axum_mw::from_fn_with_state(
                    state.clone(),
                    middleware::auth::authenticate,
                )),
        );

    let billing_routes = Router::new()
        .route("/subscribe", post(routes::billing::subscribe))
        .route("/portal", post(routes::billing::portal))
        .route("/plans", get(routes::billing::plans))
        .route("/status", get(routes::billing::subscription_status))
        .route("/cancel", post(routes::billing::cancel))
        .route("/resume", post(routes::billing::resume))
        .route("/usage", get(routes::billing::usage))
        .route("/entitlements", get(routes::billing::entitlements))
        .route("/upgrade-badge", get(routes::billing::upgrade_badge))
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            middleware::auth::authenticate,
        ));

    let org_routes = Router::new()
        .route(
            "/",
            post(routes::organisations::create_org).get(routes::organisations::list_orgs),
        )
        .route("/:id", get(routes::organisations::get_org))
        .route("/:id/members", post(routes::organisations::add_member))
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            middleware::auth::authenticate,
        ));

    let admin_routes = Router::new()
        .route("/stats", get(routes::admin::stats))
        .route("/queue", get(routes::admin::moderation_queue))
        .route("/reports", get(routes::admin::list_reports))
        .route(
            "/comments/:id/approve",
            post(routes::admin::approve_comment),
        )
        .route("/comments/:id/hide", post(routes::admin::hide_comment))
        .route(
            "/comments/:id/remove",
            post(routes::admin::remove_comment),
        )
        .route(
            "/comments/:id/restore",
            post(routes::admin::restore_comment),
        )
        .route(
            "/reviews/:id/approve",
            post(routes::admin::approve_review),
        )
        .route("/reviews/:id/hide", post(routes::admin::hide_review))
        .route(
            "/reviews/:id/remove",
            post(routes::admin::remove_review),
        )
        .route(
            "/reports/:id/resolve",
            post(routes::admin::resolve_report),
        )
        .route(
            "/reports/:id/dismiss",
            post(routes::admin::dismiss_report),
        )
        .route("/users", get(routes::admin::search_users))
        .route("/users/:id", get(routes::admin::get_user_detail))
        .route("/users/:id/warn", post(routes::admin::warn_user))
        .route("/users/:id/ban", post(routes::admin::ban_user))
        .route("/users/:id/role", post(routes::admin::set_role))
        .route("/log", get(routes::admin::moderation_log))
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            middleware::admin::require_moderator,
        ))
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            middleware::auth::authenticate,
        ));

    let admin_game_routes = Router::new()
        .route(
            "/",
            get(routes::games::admin_list_games).post(routes::games::create_game),
        )
        .route(
            "/:id",
            put(routes::games::update_game).delete(routes::games::delete_game),
        )
        .route("/:id/toggle", post(routes::games::toggle_game))
        .route(
            "/categories/all",
            get(routes::games::admin_list_categories),
        )
        .route("/categories", post(routes::games::create_category))
        .route(
            "/categories/:id",
            put(routes::games::update_category).delete(routes::games::delete_category),
        )
        .route(
            "/:id/categories",
            put(routes::games::assign_categories),
        )
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            middleware::admin::require_admin,
        ))
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            middleware::auth::authenticate,
        ));

    let multiplayer_routes = Router::new()
        .route("/rooms", get(routes::multiplayer::list_rooms).post(routes::multiplayer::create_room))
        .route("/rooms/:id", get(routes::multiplayer::get_room))
        .route("/rooms/:id/join", post(routes::multiplayer::join_room))
        .route("/matchmake", post(routes::multiplayer::matchmake))
        .route("/me", get(routes::multiplayer::my_room))
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            middleware::auth::authenticate,
        ));

    let friend_routes = Router::new()
        .route("/", get(routes::friends::list_friends))
        .route("/requests", get(routes::friends::friend_requests))
        .route("/online", get(routes::friends::online_friends))
        .route("/request", post(routes::friends::send_request))
        .route("/:id/accept", post(routes::friends::accept_request))
        .route("/:id/decline", post(routes::friends::decline_request))
        .route("/:id/remove", post(routes::friends::remove_friend))
        .route("/:id/block", post(routes::friends::block_player))
        .route("/:id/unblock", post(routes::friends::unblock_player))
        .route("/blocked", get(routes::friends::blocked_list))
        .route("/:id/invite", post(routes::friends::invite_to_game))
        .route("/search", get(routes::friends::search_players))
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            middleware::auth::authenticate,
        ));

    let economy_routes = Router::new()
        .route("/wallet", get(routes::economy::get_wallet))
        .route("/transactions", get(routes::economy::get_transactions))
        .route("/earn", post(routes::economy::earn))
        .route("/store", get(routes::economy::list_store))
        .route("/store/purchase", post(routes::economy::purchase))
        .route("/inventory", get(routes::economy::inventory))
        .route("/battlepass", get(routes::economy::get_battlepass))
        .route(
            "/battlepass/progress",
            get(routes::economy::get_battlepass_progress),
        )
        .route(
            "/battlepass/purchase",
            post(routes::economy::purchase_battlepass),
        )
        .route("/battlepass/claim", post(routes::economy::claim_tier))
        .route("/battlepass/xp", post(routes::economy::award_xp))
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            middleware::auth::authenticate,
        ));

    let presence_routes = Router::new()
        .route("/me", get(routes::presence::get_my_presence))
        .route("/update", post(routes::presence::update_presence))
        .route("/heartbeat", post(routes::presence::heartbeat))
        .route("/:id", get(routes::presence::get_player_presence))
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            middleware::auth::authenticate,
        ));

    let compliance_routes = Router::new()
        .route(
            "/consent",
            get(routes::compliance::get_consent).post(routes::compliance::record_consent),
        )
        .route("/export", post(routes::compliance::request_export))
        .route("/export/:id", get(routes::compliance::get_export_status))
        .route("/delete", post(routes::compliance::request_deletion))
        .route("/privacy-policy", get(routes::compliance::privacy_policy))
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            middleware::auth::authenticate,
        ));

    // Public game endpoints
    let public_game_routes = Router::new()
        .route("/custom", get(routes::games::list_custom_games))
        .route("/categories", get(routes::games::list_categories));

    // --- Compose full API ---
    let api = Router::new()
        .nest("/auth", auth_routes)
        .nest("/scores", score_routes)
        .nest("/leaderboards", leaderboard_routes)
        .nest("/player", player_routes)
        .nest("/sync", sync_routes)
        .nest("/comments", comment_routes)
        .nest("/billing", billing_routes)
        .nest("/organisations", org_routes)
        .nest("/webhooks", webhook_routes)
        .nest("/admin", admin_routes)
        .nest("/admin/games", admin_game_routes)
        .nest("/multiplayer", multiplayer_routes)
        .nest("/friends", friend_routes)
        .nest("/economy", economy_routes)
        .nest("/presence", presence_routes)
        .nest("/compliance", compliance_routes)
        .nest("/games", public_game_routes);

    Router::new()
        .nest("/api/v1", api)
        .route("/health", get(routes::health::health))
        .route("/metrics", get(routes::health::metrics))
        // Global middleware
        .layer(axum_mw::from_fn(middleware::localization::locale_detector))
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            middleware::rate_limit::rate_limit,
        ))
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            middleware::tenant::resolve_tenant,
        ))
        .layer(CompressionLayer::new())
        .layer(cors)
        .with_state(state)
}

#[shuttle_runtime::main]
async fn main() -> shuttle_axum::ShuttleAxum {
    let _ = dotenvy::dotenv();
    let config = Config::from_env();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .json()
        .init();

    let pool = db::create_pool(&config).await;
    let cache = Cache::new(&config).await;
    let stripe = StripeClient::new(&config.stripe);
    let rate_limiter =
        RateLimiter::new(config.rate_limit.max_requests, config.rate_limit.window_secs);
    let score_rate_limiter = RateLimiter::new(
        config.rate_limit.score_submit_max,
        config.rate_limit.window_secs,
    );

    tracing::info!("STEM Adventures API initialized (Rust/Axum on Shuttle)");

    let state = AppState {
        db: pool,
        cache,
        config: Arc::new(config),
        stripe,
        rate_limiter,
        score_rate_limiter,
        room_manager: RoomManager::new(),
    };

    let router = build_router(state);
    Ok(router.into())
}
