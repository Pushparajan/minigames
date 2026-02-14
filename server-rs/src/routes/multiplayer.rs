use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::AppResult;
use crate::middleware::auth::AuthPlayer;
use crate::models::multiplayer::*;
use crate::AppState;

#[derive(Deserialize)]
pub struct RoomQuery {
    #[serde(rename = "gameId")]
    pub game_id: Option<String>,
    pub state: Option<String>,
}

pub async fn list_rooms(
    State(state): State<AppState>,
    Query(q): Query<RoomQuery>,
) -> AppResult<Json<Value>> {
    let rooms = state
        .room_manager
        .list_rooms(q.game_id.as_deref(), q.state.as_deref())
        .await;

    Ok(Json(json!({ "rooms": rooms })))
}

pub async fn create_room(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    Json(body): Json<CreateRoomRequest>,
) -> AppResult<Json<Value>> {
    let p = get_room_player(&state, player.id).await?;
    let room = state
        .room_manager
        .create_room(p, body.game_id, body.max_players.unwrap_or(4), body.is_private.unwrap_or(false))
        .await;

    Ok(Json(json!({ "room": room })))
}

pub async fn get_room(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    let room = state.room_manager.get_room(&id).await;
    match room {
        Some(r) => Ok(Json(json!({ "room": r }))),
        None => Err(crate::error::AppError::NotFound("Room not found".into())),
    }
}

pub async fn join_room(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    let p = get_room_player(&state, player.id).await?;
    let room = state.room_manager.join_room(&id, p).await?;
    Ok(Json(json!({ "room": room })))
}

pub async fn matchmake(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    Json(body): Json<MatchmakeRequest>,
) -> AppResult<Json<Value>> {
    let p = get_room_player(&state, player.id).await?;
    let room = state.room_manager.find_match(p, &body.game_id).await;
    Ok(Json(json!({ "room": room })))
}

pub async fn my_room(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
) -> AppResult<Json<Value>> {
    let room = state.room_manager.get_player_room(player.id).await;
    Ok(Json(json!({ "room": room })))
}

async fn get_room_player(
    state: &AppState,
    player_id: uuid::Uuid,
) -> crate::error::AppResult<RoomPlayer> {
    let row: (String, String) = sqlx::query_as(
        "SELECT display_name, avatar_character FROM players WHERE id = $1",
    )
    .bind(player_id)
    .fetch_one(&state.db)
    .await?;

    Ok(RoomPlayer {
        id: player_id,
        display_name: row.0,
        avatar_character: row.1,
    })
}
