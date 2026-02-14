/* ============================================
   STEM School Adventures - Shared TypeScript Types
   ============================================ */

/** Bevy WASM bridge attached to window by the game engine */
export interface BevyBridge {
  startGame(gameId: string): void;
  stopGame(): void;
  onScore?: (score: number) => void;
  onGameOver?: (finalScore: number) => void;
}

declare global {
  interface Window {
    __bevyBridge?: BevyBridge;
  }
}

/* ---------- Player / Auth ---------- */

export interface Player {
  playerId: string;
  displayName: string;
  email?: string;
  avatarCharacter: string;
  isGuest: boolean;
  totalScore: number;
  gamesPlayed: number;
  adminRole?: string | null;
}

export interface AuthResponse {
  token: string;
  refreshToken: string;
  playerId?: string;
  id?: string;
  displayName?: string;
  player?: { id: string; displayName: string };
  playerData?: Record<string, unknown>;
}

/* ---------- Games ---------- */

export interface GameMeta {
  id: string;
  title: string;
  classic: string;
  character: string;
  mechanic: string;
  iconColor: string;
  iconEmoji: string;
  physics?: string;
  sortOrder?: number;
  isActive?: boolean;
  categories?: string[];
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  icon_emoji: string;
  icon_color: string;
  sort_order: number;
  gameIds: string[];
  game_count?: number;
  is_active?: boolean;
}

export interface GameProgress {
  highScore: number;
  stars: number;
  playCount: number;
}

/* ---------- Multiplayer ---------- */

export interface Room {
  id: string;
  name: string;
  gameId: string;
  hostId: string;
  players: RoomPlayer[];
  playerCount: number;
  maxPlayers: number;
  state: "waiting" | "playing" | "finished";
  isPrivate: boolean;
}

export interface RoomPlayer {
  id: string;
  displayName: string;
  isHost: boolean;
  isReady: boolean;
}

export interface ChatMessage {
  displayName: string;
  message: string;
  timestamp?: number;
}

/* ---------- Billing ---------- */

export interface Subscription {
  planTier: string;
  status: string;
  trialEnd?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
}

export interface BillingStatus {
  plan?: string;
  subscription?: Subscription | null;
  organisationId?: string;
}

export interface PlanTier {
  name: string;
  price: string;
  period?: string;
  features: string[];
  tier: string;
  featured?: boolean;
}

/* ---------- Sync ---------- */

export interface SyncOperation {
  type: string;
  gameId?: string;
  data: Record<string, unknown>;
  timestamp: number;
}

/* ---------- Admin ---------- */

export interface AdminStats {
  totalPlayers: number;
  totalScores: number;
  totalGames: number;
  activeSubscriptions: number;
}

export interface ModerationItem {
  id: string;
  type: "comment" | "review" | "report";
  content: string;
  authorName: string;
  gameId?: string;
  createdAt: string;
  status: string;
}

/* ---------- API Error ---------- */

export interface ApiError {
  message: string;
  code?: string;
}
