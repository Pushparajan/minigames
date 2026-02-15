import type {
  AuthResponse,
  BillingStatus,
  Category,
  GameMeta,
  SyncOperation,
} from "../types";

/* ============================================
   API Client for STEM School Adventures
   Base: /api/v1
   ============================================ */

const API_BASE = "/api/v1";
const TOKEN_KEY = "stem_auth_token";
const REFRESH_KEY = "stem_refresh_token";
const SYNC_QUEUE_KEY = "stem_sync_queue";

/* ---------- helpers ---------- */

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function setTokens(token: string, refresh?: string) {
  localStorage.setItem(TOKEN_KEY, token);
  if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
}

function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

/* ---------- core fetch wrapper ---------- */

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;

    const data = await res.json();
    if (data.token) {
      setTokens(data.token, data.refreshToken ?? refreshToken);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const opts: RequestInit = { method, headers };
  if (body && method !== "GET") opts.body = JSON.stringify(body);

  let response = await fetch(`${API_BASE}${path}`, opts);

  // Auto-refresh on 401
  if (response.status === 401 && localStorage.getItem(REFRESH_KEY)) {
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = tryRefresh().finally(() => {
        isRefreshing = false;
        refreshPromise = null;
      });
    }

    const refreshed = await (refreshPromise ?? tryRefresh());
    if (refreshed) {
      const newToken = getToken();
      if (newToken) headers["Authorization"] = `Bearer ${newToken}`;
      response = await fetch(`${API_BASE}${path}`, { ...opts, headers });
    }
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const err: { message: string; code?: string } = {
      message: data.error ?? data.message ?? "Request failed",
      code: data.code,
    };
    throw err;
  }

  return response.json() as Promise<T>;
}

/* ---------- Offline sync queue ---------- */

function getSyncQueue(): SyncOperation[] {
  try {
    return JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function pushSyncQueue(op: SyncOperation) {
  const queue = getSyncQueue();
  queue.push(op);
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
}

function clearSyncQueue() {
  localStorage.removeItem(SYNC_QUEUE_KEY);
}

/* ============================================
   Public API
   ============================================ */

const api = {
  /* --- Auth --- */

  async login(email: string, password: string): Promise<AuthResponse> {
    const res = await request<AuthResponse>("POST", "/auth/login", {
      email,
      password,
    });
    if (res.token) setTokens(res.token, res.refreshToken);
    return res;
  },

  async register(
    email: string,
    password: string,
    displayName: string,
  ): Promise<AuthResponse> {
    const res = await request<AuthResponse>("POST", "/auth/register", {
      email,
      password,
      displayName,
    });
    if (res.token) setTokens(res.token, res.refreshToken);
    return res;
  },

  async guestLogin(): Promise<AuthResponse> {
    const res = await request<AuthResponse>("POST", "/auth/guest", {});
    if (res.token) setTokens(res.token, res.refreshToken);
    return res;
  },

  logout() {
    clearTokens();
  },

  getToken,

  /* --- Games / Categories --- */

  async getCategories(): Promise<{ categories: Category[] }> {
    return request("GET", "/games/categories");
  },

  async getCustomGames(): Promise<{ games: GameMeta[] }> {
    return request("GET", "/games/custom");
  },

  /* --- Scores --- */

  async submitScore(
    gameId: string,
    score: number,
    extras?: Record<string, unknown>,
  ): Promise<unknown> {
    const payload = { score, ...extras };

    if (!navigator.onLine) {
      pushSyncQueue({
        type: "score",
        gameId,
        data: payload,
        timestamp: Date.now(),
      });
      return { queued: true };
    }

    return request("POST", `/scores/${gameId}`, payload);
  },

  /* --- Leaderboards --- */

  async getLeaderboard(
    gameId: string,
    params?: Record<string, string>,
  ): Promise<unknown> {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return request("GET", `/leaderboards/${gameId}${qs}`);
  },

  /* --- Player --- */

  async getProfile(): Promise<{
    player: {
      id: string;
      display_name: string;
      avatar_character: string;
      admin_role?: string;
      total_score: number;
      games_played: number;
    };
  }> {
    return request("GET", "/player/profile");
  },

  /* --- Billing --- */

  async getBillingStatus(): Promise<BillingStatus> {
    return request("GET", "/billing/status");
  },

  async subscribe(
    orgId: string,
    planTier: string,
    trial: boolean,
  ): Promise<unknown> {
    return request("POST", "/billing/subscribe", {
      organisationId: orgId,
      planTier,
      trial,
    });
  },

  async billingPortal(orgId: string, returnUrl: string): Promise<{ url: string }> {
    return request("POST", "/billing/portal", {
      organisationId: orgId,
      returnUrl,
    });
  },

  async cancelSubscription(
    orgId: string,
    immediate = false,
  ): Promise<unknown> {
    return request("POST", "/billing/cancel", {
      organisationId: orgId,
      immediate,
    });
  },

  async resumeSubscription(orgId: string): Promise<unknown> {
    return request("POST", "/billing/resume", { organisationId: orgId });
  },

  /* --- Organisations --- */

  async getOrganisations(): Promise<{
    organisations: { id: string; name: string }[];
  }> {
    return request("GET", "/organisations");
  },

  async createOrganisation(name: string): Promise<{ organisation?: { id: string }; id?: string }> {
    return request("POST", "/organisations", { name });
  },

  /* --- Sync --- */

  async batchSync(operations: SyncOperation[]): Promise<unknown> {
    return request("POST", "/sync/batch", { operations });
  },

  /** Flush any operations queued while offline */
  async flushSyncQueue(): Promise<void> {
    const queue = getSyncQueue();
    if (queue.length === 0) return;

    try {
      await api.batchSync(queue);
      clearSyncQueue();
    } catch {
      /* will retry next time */
    }
  },

  /* --- Admin games --- */

  async adminListGames(): Promise<{ games: GameMeta[] }> {
    return request("GET", "/admin/games");
  },

  async adminCreateGame(data: Record<string, unknown>): Promise<unknown> {
    return request("POST", "/admin/games", data);
  },

  async adminUpdateGame(
    id: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return request("PUT", `/admin/games/${id}`, data);
  },

  async adminDeleteGame(id: string): Promise<unknown> {
    return request("DELETE", `/admin/games/${id}`);
  },

  async adminToggleGame(id: string): Promise<unknown> {
    return request("POST", `/admin/games/${id}/toggle`);
  },

  async adminListCategories(): Promise<{ categories: Category[] }> {
    return request("GET", "/admin/games/categories/all");
  },

  async adminCreateCategory(data: Record<string, unknown>): Promise<unknown> {
    return request("POST", "/admin/games/categories", data);
  },

  async adminUpdateCategory(
    id: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return request("PUT", `/admin/games/categories/${id}`, data);
  },

  async adminDeleteCategory(id: string): Promise<unknown> {
    return request("DELETE", `/admin/games/categories/${id}`);
  },

  async adminAssignCategories(
    gameId: string,
    categoryIds: string[],
  ): Promise<unknown> {
    return request("PUT", `/admin/games/${gameId}/categories`, { categoryIds });
  },

  /* --- Admin moderation --- */

  async adminGetStats(): Promise<unknown> {
    return request("GET", "/admin/stats");
  },

  async adminModerationQueue(): Promise<unknown> {
    return request("GET", "/admin/queue");
  },

  async adminApproveComment(id: string): Promise<unknown> {
    return request("POST", `/admin/comments/${id}/approve`);
  },

  async adminHideComment(id: string): Promise<unknown> {
    return request("POST", `/admin/comments/${id}/hide`);
  },

  async adminRemoveComment(id: string): Promise<unknown> {
    return request("POST", `/admin/comments/${id}/remove`);
  },

  /* --- Multiplayer (REST portion) --- */

  async listRooms(gameId?: string): Promise<{ rooms: unknown[] }> {
    const qs = gameId ? `?gameId=${gameId}` : "";
    return request("GET", `/multiplayer/rooms${qs}`);
  },

  async createRoom(
    gameId: string,
    opts: { name?: string; maxPlayers?: number; isPrivate?: boolean },
  ): Promise<{ room: unknown }> {
    return request("POST", "/multiplayer/rooms", { gameId, ...opts });
  },

  async joinRoom(roomId: string): Promise<{ room: unknown }> {
    return request("POST", `/multiplayer/rooms/${roomId}/join`);
  },

  async matchmake(gameId: string): Promise<{ room: unknown }> {
    return request("POST", "/multiplayer/matchmake", { gameId });
  },
};

// Flush offline queue when coming online
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    void api.flushSyncQueue();
  });
}

export default api;
