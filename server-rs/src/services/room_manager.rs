use chrono::Utc;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::multiplayer::{Room, RoomPlayer};

#[derive(Clone)]
pub struct RoomManager {
    rooms: Arc<RwLock<HashMap<String, Room>>>,
    player_rooms: Arc<RwLock<HashMap<Uuid, String>>>,
}

impl RoomManager {
    pub fn new() -> Self {
        Self {
            rooms: Arc::new(RwLock::new(HashMap::new())),
            player_rooms: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn list_rooms(
        &self,
        game_id: Option<&str>,
        state: Option<&str>,
    ) -> Vec<Room> {
        let rooms = self.rooms.read().await;
        rooms
            .values()
            .filter(|r| {
                if r.is_private {
                    return false;
                }
                if let Some(gid) = game_id {
                    if r.game_id != gid {
                        return false;
                    }
                }
                if let Some(s) = state {
                    if r.state != s {
                        return false;
                    }
                }
                true
            })
            .cloned()
            .collect()
    }

    pub async fn create_room(
        &self,
        player: RoomPlayer,
        game_id: String,
        max_players: i32,
        is_private: bool,
    ) -> Room {
        let room_id = Uuid::new_v4().to_string();
        let room = Room {
            id: room_id.clone(),
            game_id,
            host_id: player.id,
            players: vec![player.clone()],
            max_players,
            state: "waiting".to_string(),
            is_private,
            created_at: Utc::now(),
        };

        let mut rooms = self.rooms.write().await;
        rooms.insert(room_id.clone(), room.clone());

        let mut pr = self.player_rooms.write().await;
        pr.insert(player.id, room_id);

        room
    }

    pub async fn join_room(
        &self,
        room_id: &str,
        player: RoomPlayer,
    ) -> AppResult<Room> {
        let mut rooms = self.rooms.write().await;
        let room = rooms
            .get_mut(room_id)
            .ok_or_else(|| AppError::NotFound("Room not found".into()))?;

        if room.state != "waiting" {
            return Err(AppError::BadRequest("Game already in progress".into()));
        }
        if room.players.len() >= room.max_players as usize {
            return Err(AppError::BadRequest("Room is full".into()));
        }
        if room.players.iter().any(|p| p.id == player.id) {
            return Err(AppError::Conflict("Already in room".into()));
        }

        let pid = player.id;
        room.players.push(player);
        let result = room.clone();

        drop(rooms);
        let mut pr = self.player_rooms.write().await;
        pr.insert(pid, room_id.to_string());

        Ok(result)
    }

    pub async fn get_room(&self, room_id: &str) -> Option<Room> {
        let rooms = self.rooms.read().await;
        rooms.get(room_id).cloned()
    }

    pub async fn find_match(
        &self,
        player: RoomPlayer,
        game_id: &str,
    ) -> Room {
        // Try to find a waiting room
        let rooms = self.rooms.read().await;
        for room in rooms.values() {
            if room.game_id == game_id
                && room.state == "waiting"
                && !room.is_private
                && (room.players.len() as i32) < room.max_players
                && !room.players.iter().any(|p| p.id == player.id)
            {
                let room_id = room.id.clone();
                drop(rooms);
                if let Ok(room) = self.join_room(&room_id, player.clone()).await {
                    return room;
                }
                // If join failed, create a new room
                return self.create_room(player, game_id.to_string(), 4, false).await;
            }
        }
        drop(rooms);

        // No room found, create one
        self.create_room(player, game_id.to_string(), 4, false).await
    }

    pub async fn get_player_room(&self, player_id: Uuid) -> Option<Room> {
        let pr = self.player_rooms.read().await;
        let room_id = pr.get(&player_id)?;
        let rooms = self.rooms.read().await;
        rooms.get(room_id).cloned()
    }
}
