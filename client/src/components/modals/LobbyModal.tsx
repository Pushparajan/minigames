import {
  useEffect,
  useState,
  useRef,
  useCallback,
  type FormEvent,
} from "react";
import { useGameStore } from "../../stores/useGameStore";
import api from "../../api/client";
import type { Room, ChatMessage } from "../../types";

/* ============================================
   LobbyModal — Multiplayer lobby
   ============================================ */

type LobbyView = "list" | "create" | "room";

interface LobbyModalProps {
  open: boolean;
  onClose: () => void;
}

export default function LobbyModal({ open, onClose }: LobbyModalProps) {
  const { games } = useGameStore();
  const [view, setView] = useState<LobbyView>("list");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [filterGame, setFilterGame] = useState("");

  // Create room form state
  const [createGameId, setCreateGameId] = useState(games[0]?.id ?? "");
  const [createName, setCreateName] = useState("");
  const [createMax, setCreateMax] = useState(2);
  const [createPrivate, setCreatePrivate] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  /* ---------- WebSocket connection ---------- */

  const connectWs = useCallback(() => {
    const token = localStorage.getItem("stem_auth_token");
    if (!token) return;

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${proto}//${window.location.host}/api/v1/multiplayer/ws?token=${token}`,
    );

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type: string;
          room?: Room;
          player?: { displayName: string };
          displayName?: string;
          message?: string;
          scores?: number[];
        };

        switch (msg.type) {
          case "room_update":
            if (msg.room) {
              setCurrentRoom(msg.room);
              setView("room");
            }
            break;
          case "player_joined":
            if (msg.player) {
              setChatMessages((prev) => [
                ...prev,
                {
                  displayName: "System",
                  message: `${msg.player!.displayName} joined the room`,
                },
              ]);
            }
            break;
          case "player_left":
            setChatMessages((prev) => [
              ...prev,
              {
                displayName: "System",
                message: "A player left the room",
              },
            ]);
            break;
          case "chat":
            if (msg.displayName && msg.message) {
              setChatMessages((prev) => [
                ...prev,
                {
                  displayName: msg.displayName!,
                  message: msg.message!,
                },
              ]);
            }
            break;
          case "game_started":
            onClose();
            break;
          case "error":
            console.warn("Lobby WS error:", msg.message);
            break;
        }
      } catch {
        /* ignore parse errors */
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    wsRef.current = ws;
  }, [onClose]);

  const sendWs = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  /* ---------- Lifecycle ---------- */

  useEffect(() => {
    if (open) {
      setView("list");
      setIsReady(false);
      setChatMessages([]);
      void refreshRooms();
      connectWs();
    } else {
      wsRef.current?.close();
      wsRef.current = null;
    }

    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [open, connectWs]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  /* ---------- Room list ---------- */

  async function refreshRooms() {
    try {
      const res = await api.listRooms(filterGame || undefined);
      setRooms((res.rooms ?? []) as Room[]);
    } catch {
      /* ignore */
    }
  }

  async function handleJoinRoom(roomId: string) {
    try {
      const res = await api.joinRoom(roomId);
      if (res.room) {
        setCurrentRoom(res.room as Room);
        setView("room");
      }
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : "Failed to join room";
      alert(msg);
    }
  }

  /* ---------- Create room ---------- */

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await api.createRoom(createGameId, {
        name: createName || undefined,
        maxPlayers: createMax,
        isPrivate: createPrivate,
      });
      if (res.room) {
        setCurrentRoom(res.room as Room);
        setView("room");
      }
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : "Failed to create room";
      alert(msg);
    }
  }

  /* ---------- In-room actions ---------- */

  function handleToggleReady() {
    const next = !isReady;
    setIsReady(next);
    sendWs({ type: "ready", ready: next });
  }

  function handleStartGame() {
    sendWs({ type: "start" });
  }

  function handleLeave() {
    sendWs({ type: "leave" });
    setCurrentRoom(null);
    setIsReady(false);
    setChatMessages([]);
    setView("list");
    void refreshRooms();
  }

  function handleSendChat() {
    const msg = chatInput.trim();
    if (!msg) return;
    sendWs({ type: "chat", message: msg });
    setChatInput("");
  }

  /* ---------- Determine if host ---------- */

  const myId = localStorage.getItem("stem_player_id") ?? "";
  const isHost = currentRoom?.hostId === myId;

  /* ---------- Render ---------- */

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-lobby-title"
      >
        <h2 id="modal-lobby-title">Multiplayer Lobby</h2>

        {/* ===== Room List View ===== */}
        {view === "list" && (
          <div>
            <div className="lobby-actions">
              <label htmlFor="lobby-game-filter" className="sr-only">
                Filter by game
              </label>
              <select
                id="lobby-game-filter"
                value={filterGame}
                onChange={(e) => {
                  setFilterGame(e.target.value);
                }}
              >
                <option value="">All Games</option>
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setView("create")}
              >
                Create Room
              </button>
              <button
                type="button"
                className="btn-outline"
                onClick={() => void refreshRooms()}
              >
                Refresh
              </button>
            </div>

            <div className="lobby-rooms">
              {rooms.length === 0 ? (
                <p className="lobby-empty">
                  No rooms available. Create one or use Quick Match!
                </p>
              ) : (
                rooms.map((room) => {
                  const game = games.find((g) => g.id === room.gameId);
                  return (
                    <div
                      key={room.id}
                      className="lobby-room-card"
                      onClick={() => void handleJoinRoom(room.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleJoinRoom(room.id);
                      }}
                      tabIndex={0}
                      role="button"
                    >
                      <div className="lobby-room-info">
                        <strong>{room.name}</strong>
                        <span className="lobby-room-game">
                          {game?.title ?? room.gameId}
                        </span>
                      </div>
                      <div className="lobby-room-meta">
                        <span className="lobby-room-players">
                          {room.playerCount}/{room.maxPlayers}
                        </span>
                        <span className="lobby-room-state">{room.state}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ===== Create Room View ===== */}
        {view === "create" && (
          <form onSubmit={handleCreate}>
            <label htmlFor="create-game">Game</label>
            <select
              id="create-game"
              required
              value={createGameId}
              onChange={(e) => setCreateGameId(e.target.value)}
            >
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>

            <label htmlFor="create-name">Room Name</label>
            <input
              id="create-name"
              type="text"
              placeholder="My Game Room"
              maxLength={40}
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
            />

            <label htmlFor="create-max">Max Players</label>
            <select
              id="create-max"
              value={createMax}
              onChange={(e) => setCreateMax(Number(e.target.value))}
            >
              <option value={2}>2 Players</option>
              <option value={3}>3 Players</option>
              <option value={4}>4 Players</option>
            </select>

            <label htmlFor="create-private">
              <input
                id="create-private"
                type="checkbox"
                checked={createPrivate}
                onChange={(e) => setCreatePrivate(e.target.checked)}
              />{" "}
              Private Room
            </label>

            <div className="lobby-form-actions">
              <button
                type="button"
                className="btn-outline"
                onClick={() => setView("list")}
              >
                Back
              </button>
              <button type="submit" className="btn-primary">
                Create Room
              </button>
            </div>
          </form>
        )}

        {/* ===== Room / Waiting View ===== */}
        {view === "room" && currentRoom && (
          <div>
            <div className="room-header">
              <h3>{currentRoom.name}</h3>
              <span className="room-game-badge">
                {games.find((g) => g.id === currentRoom.gameId)?.title ??
                  currentRoom.gameId}
              </span>
            </div>

            <div className="room-players">
              {currentRoom.players.map((p) => (
                <div
                  key={p.id}
                  className={`room-player${p.id === myId ? " room-player-me" : ""}${p.isReady ? " room-player-ready" : ""}`}
                >
                  <span className="room-player-name">
                    {p.displayName}
                    {p.isHost ? " (Host)" : ""}
                  </span>
                  <span className="room-player-status">
                    {p.isReady ? "Ready" : "Not Ready"}
                  </span>
                </div>
              ))}
            </div>

            {/* Chat */}
            <div className="room-chat">
              <div className="room-chat-messages">
                {chatMessages.map((msg, i) => (
                  <div key={i} className="chat-msg">
                    <strong>{msg.displayName}</strong>: {msg.message}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div className="room-chat-input">
                <label htmlFor="room-chat-text" className="sr-only">
                  Chat message
                </label>
                <input
                  id="room-chat-text"
                  type="text"
                  placeholder="Type a message..."
                  maxLength={500}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSendChat();
                  }}
                />
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={handleSendChat}
                >
                  Send
                </button>
              </div>
            </div>

            <div className="room-actions">
              <button
                type="button"
                className="btn-outline"
                onClick={handleLeave}
              >
                Leave Room
              </button>
              {isHost ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleStartGame}
                >
                  Start Game
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleToggleReady}
                >
                  {isReady ? "Not Ready" : "Ready"}
                </button>
              )}
            </div>
          </div>
        )}

        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close dialog"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
