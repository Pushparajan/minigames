/**
 * RunnerScene — Side-scrolling endless runner.
 *
 * The player runs right; platforms scroll left.  Collectibles appear
 * on platforms and mid-air.  The player jumps to avoid gaps and enemies.
 *
 * Games: AlgorithmRunner, TidalWaves, WindTurbineFlyer
 */

import { useRef, useState, useCallback, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Physics, RigidBody, CuboidCollider } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import PhysicsCharacter from "../physics/PhysicsCharacter";
import PhysicsCollectible from "../physics/PhysicsCollectible";
import PhysicsObstacle from "../physics/PhysicsObstacle";

interface RunnerSceneProps {
  modelUrl?: string;
  onScore?: (score: number) => void;
  color?: string;
}

interface PlatformDef {
  id: number;
  x: number;
  width: number;
  y: number;
}

let nextId = 0;

function makePlatform(x: number): PlatformDef {
  return {
    id: nextId++,
    x,
    width: 3 + Math.random() * 4,
    y: -0.5 + Math.random() * 2,
  };
}

export default function RunnerScene({
  modelUrl,
  onScore,
  color = "#4488ff",
}: RunnerSceneProps) {
  const [score, setScore] = useState(0);

  const collect = useCallback(() => {
    setScore((prev) => {
      const next = prev + 100;
      onScore?.(next);
      return next;
    });
  }, [onScore]);

  // Generate a static set of platforms
  const platforms = useMemo(() => {
    const arr: PlatformDef[] = [];
    // Ground
    arr.push({ id: nextId++, x: 0, width: 200, y: -2 });
    // Elevated platforms
    for (let i = 0; i < 20; i++) {
      arr.push(makePlatform(4 + i * 5));
    }
    return arr;
  }, []);

  // Collectible positions on the platforms
  const collectibles = useMemo(() => {
    return platforms
      .filter((p) => p.y > -1)
      .map((p) => ({
        id: p.id + 10000,
        position: [p.x, p.y + 1.2, 0] as [number, number, number],
      }));
  }, [platforms]);

  return (
    <Physics gravity={[0, -15, 0]}>
      {/* Three-point lighting */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[10, 15, 5]} intensity={0.9} castShadow />
      <directionalLight position={[-5, 5, -5]} intensity={0.25} color="#6688ff" />

      {/* Player */}
      <PhysicsCharacter
        modelUrl={modelUrl}
        position={[0, 2, 0]}
        speed={6}
        jumpForce={8}
        color={color}
        moveAxes="xy"
        modelScale={0.7}
      />

      {/* Platforms */}
      {platforms.map((p) => (
        <PhysicsObstacle
          key={p.id}
          position={[p.x, p.y, 0]}
          size={[p.width, 0.4, 2]}
          color={p.y < -1 ? "#2a3a2a" : "#4a5568"}
          variant={p.y < -1 ? "ground" : "platform"}
        />
      ))}

      {/* Collectibles */}
      {collectibles.map((c) => (
        <PhysicsCollectible
          key={c.id}
          position={c.position}
          onCollect={collect}
          color="#ffcc00"
        />
      ))}

      {/* Walls to prevent falling off left side */}
      <PhysicsObstacle
        position={[-5, 5, 0]}
        size={[1, 20, 4]}
        color="#1a1a2e"
        variant="wall"
      />
    </Physics>
  );
}
