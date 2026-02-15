import { useEffect, useRef, useState, useCallback, lazy, Suspense } from "react";
import { useGameStore } from "../stores/useGameStore";
import api from "../api/client";

const GameOverlay3D = lazy(() => import("./three/GameOverlay3D"));
const GameScene3D = lazy(() => import("./three/GameScene3D"));

/* ============================================
   GameView — Full-screen game overlay
   Renders both the Bevy WASM 2-D canvas and the
   R3F + Rapier 3-D physics scene (stacked).
   ============================================ */

interface GameViewProps {
  gameId: string;
  onExit: () => void;
}

export default function GameView({ gameId, onExit }: GameViewProps) {
  const { games, updateProgress } = useGameStore();
  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);
  const exitingRef = useRef(false);
  const [show3D, setShow3D] = useState(true);

  const game = games.find((g) => g.id === gameId);
  const title = game?.title ?? gameId;

  /** Callback from the 3-D scene when the player scores. */
  const handlePhysicsScore = useCallback((s: number) => {
    scoreRef.current = s;
    setScore(s);
  }, []);

  /** Save score, destroy Bevy, return to grid */
  const handleExit = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;

    const finalScore = scoreRef.current;

    // Stop the Bevy instance
    try {
      window.__bevyBridge?.stopGame();
    } catch {
      /* ignore */
    }

    // Persist score
    if (finalScore > 0) {
      updateProgress(gameId, {
        highScore: finalScore,
        playCount: 1, // increment handled inside store
        stars: finalScore >= 10000 ? 3 : finalScore >= 5000 ? 2 : finalScore >= 1000 ? 1 : 0,
      });

      // Submit to server (fire-and-forget)
      void api.submitScore(gameId, finalScore);
    }

    onExit();
  }, [gameId, onExit, updateProgress]);

  // Mount: start Bevy game and wire score callbacks
  useEffect(() => {
    exitingRef.current = false;
    scoreRef.current = 0;
    setScore(0);

    // Wire up score callback before starting
    if (window.__bevyBridge) {
      window.__bevyBridge.onScore = (s: number) => {
        scoreRef.current = s;
        setScore(s);
      };

      window.__bevyBridge.onGameOver = (finalScore: number) => {
        scoreRef.current = finalScore;
        setScore(finalScore);
        handleExit();
      };

      // Start the game
      try {
        window.__bevyBridge.startGame(gameId);
      } catch (err) {
        console.error("Failed to start Bevy game:", err);
      }
    }

    return () => {
      // Cleanup on unmount
      if (window.__bevyBridge) {
        window.__bevyBridge.onScore = undefined;
        window.__bevyBridge.onGameOver = undefined;
        try {
          window.__bevyBridge.stopGame();
        } catch {
          /* ignore */
        }
      }
    };
  }, [gameId, handleExit]);

  // Escape key to exit
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") handleExit();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleExit]);

  return (
    <div
      id="game-container"
      role="region"
      aria-label="Game player"
    >
      {/* HUD bar */}
      <div id="game-hud">
        <button
          type="button"
          className="hud-btn"
          onClick={handleExit}
          aria-label="Back to game library"
        >
          &larr; Back
        </button>
        <span id="hud-title">{title}</span>

        {/* 2D / 3D toggle */}
        <button
          type="button"
          className="hud-btn"
          onClick={() => setShow3D((v) => !v)}
          style={{ fontSize: 12, padding: "2px 8px" }}
        >
          {show3D ? "2D Mode" : "3D Mode"}
        </button>

        <span id="hud-score" role="status" aria-live="polite">
          Score: {score.toLocaleString()}
        </span>
      </div>

      {/* Game area — Bevy 2D canvas + R3F 3D physics scene */}
      <div
        id="game-canvas"
        role="application"
        aria-label="Game canvas"
        style={{ position: "relative" }}
      >
        {/* R3F + Rapier 3-D physics scene (full-screen behind Bevy) */}
        {show3D && (
          <Suspense fallback={null}>
            <GameScene3D gameId={gameId} onScore={handlePhysicsScore} />
          </Suspense>
        )}

        {/* 3-D character portrait overlay (shows uploaded .glb models) */}
        {!show3D && (
          <Suspense fallback={null}>
            <GameOverlay3D />
          </Suspense>
        )}
      </div>
    </div>
  );
}
