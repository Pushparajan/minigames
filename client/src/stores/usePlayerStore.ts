import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { createElement } from "react";
import type { Player } from "../types";
import api from "../api/client";

/* ============================================
   Player Store — React Context + useState
   ============================================ */

const PLAYER_KEY = "stem_user";
const TOKEN_KEY = "stem_auth_token";
const ORG_KEY = "stem_org_id";

interface PlayerState {
  player: Player | null;
  token: string | null;
  orgId: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  guestLogin: () => Promise<void>;
  logout: () => void;
  setPlayer: (p: Player) => void;
  refreshProfile: () => Promise<void>;
}

const PlayerContext = createContext<PlayerState | null>(null);

function loadPlayer(): Player | null {
  try {
    const raw = localStorage.getItem(PLAYER_KEY);
    return raw ? (JSON.parse(raw) as Player) : null;
  } catch {
    return null;
  }
}

function savePlayer(p: Player | null) {
  if (p) {
    localStorage.setItem(PLAYER_KEY, JSON.stringify(p));
  } else {
    localStorage.removeItem(PLAYER_KEY);
  }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [player, setPlayerState] = useState<Player | null>(loadPlayer);
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem(TOKEN_KEY),
  );
  const [orgId, setOrgId] = useState<string | null>(
    () => localStorage.getItem(ORG_KEY),
  );

  const isAuthenticated = token !== null && player !== null;

  const setPlayer = useCallback((p: Player) => {
    setPlayerState(p);
    savePlayer(p);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    const newToken = res.token;
    setToken(newToken);

    const p: Player = {
      playerId: res.playerId ?? res.player?.id ?? res.id ?? "",
      displayName:
        res.displayName ?? res.player?.displayName ?? email,
      avatarCharacter: "",
      isGuest: false,
      totalScore: 0,
      gamesPlayed: 0,
    };
    setPlayerState(p);
    savePlayer(p);

    // Fetch full profile in background
    try {
      const profile = await api.getProfile();
      const updated: Player = {
        playerId: profile.player.id,
        displayName: profile.player.display_name,
        avatarCharacter: profile.player.avatar_character,
        isGuest: false,
        totalScore: profile.player.total_score,
        gamesPlayed: profile.player.games_played,
        adminRole: profile.player.admin_role ?? null,
      };
      setPlayerState(updated);
      savePlayer(updated);
    } catch {
      /* profile fetch is best-effort */
    }
  }, []);

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      const res = await api.register(email, password, displayName);
      const newToken = res.token;
      setToken(newToken);

      const p: Player = {
        playerId: res.playerId ?? res.id ?? "",
        displayName,
        avatarCharacter: "",
        isGuest: false,
        totalScore: 0,
        gamesPlayed: 0,
      };
      setPlayerState(p);
      savePlayer(p);
    },
    [],
  );

  const guestLogin = useCallback(async () => {
    const res = await api.guestLogin();
    setToken(res.token);
    const p: Player = {
      playerId: res.playerId ?? res.id ?? "",
      displayName: "Guest",
      avatarCharacter: "",
      isGuest: true,
      totalScore: 0,
      gamesPlayed: 0,
    };
    setPlayerState(p);
    savePlayer(p);
  }, []);

  const logout = useCallback(() => {
    api.logout();
    setToken(null);
    setPlayerState(null);
    setOrgId(null);
    savePlayer(null);
    localStorage.removeItem(ORG_KEY);
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const profile = await api.getProfile();
      const updated: Player = {
        playerId: profile.player.id,
        displayName: profile.player.display_name,
        avatarCharacter: profile.player.avatar_character,
        isGuest: false,
        totalScore: profile.player.total_score,
        gamesPlayed: profile.player.games_played,
        adminRole: profile.player.admin_role ?? null,
      };
      setPlayerState(updated);
      savePlayer(updated);
    } catch {
      /* ignore */
    }
  }, []);

  // On mount: if we have a token, refresh the profile
  useEffect(() => {
    if (token && player) {
      void refreshProfile();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: PlayerState = {
    player,
    token,
    orgId,
    isAuthenticated,
    login,
    register,
    guestLogin,
    logout,
    setPlayer,
    refreshProfile,
  };

  return createElement(PlayerContext.Provider, { value }, children);
}

export function usePlayerStore(): PlayerState {
  const ctx = useContext(PlayerContext);
  if (!ctx)
    throw new Error("usePlayerStore must be used within PlayerProvider");
  return ctx;
}
