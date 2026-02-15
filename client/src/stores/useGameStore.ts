import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { createElement } from "react";
import type { GameMeta, Category, GameProgress } from "../types";
import api from "../api/client";

/* ============================================
   Game Store — React Context + useState
   ============================================ */

const PROGRESS_KEY = "stem_game_progress";

/** Built-in game registry matching the original 25 games */
const BUILTIN_GAMES: GameMeta[] = [
  { id: "PhysicsMasterBilliards", title: "Physics Master Billiards", classic: "Billiards", character: "Professor Newton", mechanic: "Angle & force calculations", iconColor: "#2e7d32", iconEmoji: "🎱" },
  { id: "CircuitLabPinball", title: "Circuit Lab Pinball", classic: "Pinball", character: "Volta the Robot", mechanic: "Complete circuits to score", iconColor: "#1565c0", iconEmoji: "⚡" },
  { id: "ChemistryBubblePop", title: "Chemistry Bubble Pop", classic: "Bubble Shooter", character: "Dr. Beaker", mechanic: "Match element groups", iconColor: "#6a1b9a", iconEmoji: "🧪" },
  { id: "GravityGolfPlanets", title: "Gravity Golf Planets", classic: "Mini Golf", character: "Astro Alex", mechanic: "Orbital mechanics putting", iconColor: "#00838f", iconEmoji: "🪐" },
  { id: "DNAStackAttack", title: "DNA Stack Attack", classic: "Tetris", character: "Gene the Helix", mechanic: "Build valid DNA sequences", iconColor: "#ad1457", iconEmoji: "🧬" },
  { id: "BridgeEngineer", title: "Bridge Engineer", classic: "Bridge Builder", character: "Builder Bot", mechanic: "Structural force analysis", iconColor: "#e65100", iconEmoji: "🌉" },
  { id: "EcoSnake", title: "EcoSystem Snake", classic: "Snake", character: "Fern the Fox", mechanic: "Food chain collection", iconColor: "#2e7d32", iconEmoji: "🐍" },
  { id: "RocketLabLander", title: "Rocket Lab Lander", classic: "Lunar Lander", character: "Commander Blaze", mechanic: "Thrust & fuel management", iconColor: "#b71c1c", iconEmoji: "🚀" },
  { id: "PeriodicInvaders", title: "Periodic Invaders", classic: "Space Invaders", character: "Element-X", mechanic: "Shoot correct elements", iconColor: "#4527a0", iconEmoji: "👾" },
  { id: "GeometryBreakout", title: "Geometry Breakout", classic: "Breakout", character: "Poly Pete", mechanic: "Shape identification", iconColor: "#00695c", iconEmoji: "💎" },
  { id: "FossilDigger", title: "Fossil Digger", classic: "Minesweeper", character: "Paleo Pat", mechanic: "Excavate carefully", iconColor: "#795548", iconEmoji: "🦴" },
  { id: "WeatherDefense", title: "Weather Defense", classic: "Tower Defense", character: "Storm Scout", mechanic: "Meteorology strategy", iconColor: "#37474f", iconEmoji: "🌪️" },
  { id: "AlgorithmRunner", title: "Algorithm Runner", classic: "Endless Runner", character: "Bit the Byte", mechanic: "Follow code paths", iconColor: "#263238", iconEmoji: "🏃" },
  { id: "MicrobeMatch", title: "Microbe Match", classic: "Match-3", character: "Micro Mia", mechanic: "Match microorganisms", iconColor: "#1b5e20", iconEmoji: "🦠" },
  { id: "VoltageRacer", title: "Voltage Racer", classic: "Racing", character: "Spark", mechanic: "Energy management racing", iconColor: "#f57f17", iconEmoji: "🏎️" },
  { id: "AtomSmasher", title: "Atom Smasher", classic: "Breakout Variant", character: "Quark", mechanic: "Particle physics collisions", iconColor: "#311b92", iconEmoji: "⚛️" },
  { id: "RobotMaze", title: "Robot Maze Coder", classic: "Maze", character: "Codebot", mechanic: "Program movement commands", iconColor: "#004d40", iconEmoji: "🤖" },
  { id: "TidalWaves", title: "Tidal Waves Surfer", classic: "Surfing", character: "Marina", mechanic: "Wave frequency riding", iconColor: "#0277bd", iconEmoji: "🌊" },
  { id: "StarMapper", title: "Star Mapper", classic: "Connect Dots", character: "Nova", mechanic: "Constellation patterns", iconColor: "#1a237e", iconEmoji: "⭐" },
  { id: "VolcanoEscape", title: "Volcano Escape", classic: "Platformer", character: "Magma Max", mechanic: "Geology platforming", iconColor: "#bf360c", iconEmoji: "🌋" },
  { id: "PhotonPong", title: "Photon Pong", classic: "Pong", character: "Lux", mechanic: "Light physics pong", iconColor: "#ffd600", iconEmoji: "🏓" },
  { id: "NanoAssembler", title: "Nano Assembler", classic: "Puzzle", character: "Nano Nell", mechanic: "Molecular assembly", iconColor: "#546e7a", iconEmoji: "🔬" },
  { id: "DataMiner", title: "Data Miner", classic: "Digging", character: "Data Dan", mechanic: "Binary & data sorting", iconColor: "#3e2723", iconEmoji: "⛏️" },
  { id: "WindTurbineFlyer", title: "Wind Turbine Flyer", classic: "Flappy Bird", character: "Breeze", mechanic: "Renewable energy flight", iconColor: "#43a047", iconEmoji: "🍃" },
  { id: "GeneticBreeder", title: "Genetic Breeder", classic: "Breeding Sim", character: "Dr. Gene", mechanic: "Trait inheritance puzzles", iconColor: "#880e4f", iconEmoji: "🧫" },
];

interface GameState {
  games: GameMeta[];
  categories: Category[];
  activeCategory: string | null;
  progress: Record<string, GameProgress>;
  loading: boolean;
  loadGames: () => Promise<void>;
  setCategory: (slug: string | null) => void;
  updateProgress: (gameId: string, p: Partial<GameProgress>) => void;
  getFilteredGames: () => GameMeta[];
}

const GameContext = createContext<GameState | null>(null);

function loadProgress(): Record<string, GameProgress> {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, GameProgress>) : {};
  } catch {
    return {};
  }
}

function saveProgress(p: Record<string, GameProgress>) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
}

export function GameProvider({ children }: { children: ReactNode }) {
  const [games, setGames] = useState<GameMeta[]>(BUILTIN_GAMES);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, GameProgress>>(loadProgress);
  const [loading, setLoading] = useState(false);

  const loadGames = useCallback(async () => {
    setLoading(true);
    try {
      const [catRes, customRes] = await Promise.allSettled([
        api.getCategories(),
        api.getCustomGames(),
      ]);

      if (catRes.status === "fulfilled") {
        setCategories(catRes.value.categories);
      }

      if (customRes.status === "fulfilled" && customRes.value.games.length > 0) {
        // Merge custom games into the list, avoiding duplicates by id
        setGames((prev) => {
          const ids = new Set(prev.map((g) => g.id));
          const newGames = customRes.value.games.filter((g) => !ids.has(g.id));
          return [...prev, ...newGames];
        });
      }
    } catch {
      /* best-effort: built-in games are always available */
    } finally {
      setLoading(false);
    }
  }, []);

  const setCategory = useCallback((slug: string | null) => {
    setActiveCategory(slug);
  }, []);

  const updateProgress = useCallback(
    (gameId: string, partial: Partial<GameProgress>) => {
      setProgress((prev) => {
        const existing = prev[gameId] ?? { highScore: 0, stars: 0, playCount: 0 };
        const updated = { ...existing, ...partial };
        if (partial.highScore !== undefined && partial.highScore > existing.highScore) {
          updated.highScore = partial.highScore;
        }
        const next = { ...prev, [gameId]: updated };
        saveProgress(next);
        return next;
      });
    },
    [],
  );

  const getFilteredGames = useCallback((): GameMeta[] => {
    if (!activeCategory) return games;
    const cat = categories.find(
      (c) => c.slug === activeCategory || c.id === activeCategory,
    );
    if (!cat || !cat.gameIds || cat.gameIds.length === 0) return games;
    const idSet = new Set(cat.gameIds);
    return games.filter((g) => idSet.has(g.id));
  }, [games, categories, activeCategory]);

  // Load categories and custom games on mount
  useEffect(() => {
    void loadGames();
  }, [loadGames]);

  const value: GameState = {
    games,
    categories,
    activeCategory,
    progress,
    loading,
    loadGames,
    setCategory,
    updateProgress,
    getFilteredGames,
  };

  return createElement(GameContext.Provider, { value }, children);
}

export function useGameStore(): GameState {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGameStore must be used within GameProvider");
  return ctx;
}
