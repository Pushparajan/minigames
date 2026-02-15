/**
 * GameScene3D — Routes each game ID to the appropriate R3F + Rapier
 * physics scene.  Wraps everything in a full-screen Canvas.
 *
 * Each game is mapped to one of six scene types:
 *   runner, arena, platform, billiard, vehicle, puzzle
 */

import { Suspense, lazy, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { useModelUrls } from "../../stores/useAssetStore";

// Lazy-load scenes so only the active scene is bundled
const RunnerScene = lazy(() => import("./scenes/RunnerScene"));
const ArenaScene = lazy(() => import("./scenes/ArenaScene"));
const PlatformScene = lazy(() => import("./scenes/PlatformScene"));
const BilliardScene = lazy(() => import("./scenes/BilliardScene"));
const VehicleScene = lazy(() => import("./scenes/VehicleScene"));
const PuzzleScene = lazy(() => import("./scenes/PuzzleScene"));

type SceneType = "runner" | "arena" | "platform" | "billiard" | "vehicle" | "puzzle";

/** Map every game ID to a scene type and character colour. */
const GAME_SCENE_MAP: Record<string, { scene: SceneType; color: string }> = {
  // Runners
  AlgorithmRunner:   { scene: "runner",   color: "#4488ff" },
  TidalWaves:        { scene: "runner",   color: "#0277bd" },
  WindTurbineFlyer:  { scene: "runner",   color: "#43a047" },

  // Arena / Shooter
  PeriodicInvaders:  { scene: "arena",    color: "#4527a0" },
  WeatherDefense:    { scene: "arena",    color: "#37474f" },
  AtomSmasher:       { scene: "arena",    color: "#311b92" },

  // Platformer
  VolcanoEscape:     { scene: "platform", color: "#bf360c" },
  RobotMaze:         { scene: "platform", color: "#004d40" },
  DataMiner:         { scene: "platform", color: "#3e2723" },
  FossilDigger:      { scene: "platform", color: "#795548" },

  // Billiard / Ball physics
  PhysicsMasterBilliards: { scene: "billiard", color: "#eeeeee" },
  MicrobeMatch:      { scene: "billiard", color: "#1b5e20" },

  // Vehicle / Racing
  VoltageRacer:      { scene: "vehicle",  color: "#f57f17" },
  RocketLabLander:   { scene: "vehicle",  color: "#b71c1c" },
  GravityGolfPlanets:{ scene: "vehicle",  color: "#00838f" },

  // Puzzle / Sandbox (everything else)
  NanoAssembler:     { scene: "puzzle",   color: "#546e7a" },
  GeneticBreeder:    { scene: "puzzle",   color: "#880e4f" },
  DNAStackAttack:    { scene: "puzzle",   color: "#ad1457" },
  StarMapper:        { scene: "puzzle",   color: "#1a237e" },
  BridgeEngineer:    { scene: "puzzle",   color: "#e65100" },
  CircuitLabPinball: { scene: "puzzle",   color: "#1565c0" },
  ChemistryBubblePop:{ scene: "puzzle",   color: "#6a1b9a" },
  EcoSnake:          { scene: "puzzle",   color: "#2e7d32" },
  GeometryBreakout:  { scene: "puzzle",   color: "#00695c" },
  PhotonPong:        { scene: "puzzle",   color: "#ffd600" },
};

function LoadingFallback() {
  return (
    <mesh>
      <sphereGeometry args={[0.5, 16, 16]} />
      <meshStandardMaterial color="#4444aa" wireframe />
    </mesh>
  );
}

interface GameScene3DProps {
  gameId: string;
  onScore?: (score: number) => void;
}

export default function GameScene3D({ gameId, onScore }: GameScene3DProps) {
  const models = useModelUrls();

  // Pick the best available model URL
  const modelUrl = useMemo(() => {
    return (
      models.get("hero") ??
      models.get("enemy") ??
      [...models.values()][0]
    );
  }, [models]);

  const config = GAME_SCENE_MAP[gameId] ?? { scene: "puzzle", color: "#4488ff" };

  // Camera setup varies by scene type
  const cameraProps = useMemo(() => {
    switch (config.scene) {
      case "runner":
        return { position: [0, 4, 12] as [number, number, number], fov: 50 };
      case "arena":
        return { position: [0, 14, 8] as [number, number, number], fov: 55 };
      case "platform":
        return { position: [0, 5, 14] as [number, number, number], fov: 50 };
      case "billiard":
        return { position: [0, 12, 4] as [number, number, number], fov: 45 };
      case "vehicle":
        return { position: [0, 16, 10] as [number, number, number], fov: 50 };
      case "puzzle":
      default:
        return { position: [0, 10, 10] as [number, number, number], fov: 50 };
    }
  }, [config.scene]);

  const SceneComponent = useMemo(() => {
    switch (config.scene) {
      case "runner":   return RunnerScene;
      case "arena":    return ArenaScene;
      case "platform": return PlatformScene;
      case "billiard": return BilliardScene;
      case "vehicle":  return VehicleScene;
      case "puzzle":
      default:         return PuzzleScene;
    }
  }, [config.scene]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "radial-gradient(ellipse at 50% 30%, #1a1a36 0%, #060612 100%)",
      }}
    >
      <Canvas
        shadows
        camera={cameraProps}
        gl={{ antialias: true, alpha: false }}
        style={{ width: "100%", height: "100%" }}
      >
        <Suspense fallback={<LoadingFallback />}>
          <SceneComponent
            modelUrl={modelUrl}
            onScore={onScore}
            color={config.color}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
