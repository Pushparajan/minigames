/**
 * PlatformScene — Classic platformer with multi-tier platforms,
 * moving obstacles, and collectibles.
 *
 * Games: VolcanoEscape, RobotMaze, DataMiner, FossilDigger
 */

import { useState, useCallback, useMemo } from "react";
import { Physics } from "@react-three/rapier";
import PhysicsCharacter from "../physics/PhysicsCharacter";
import PhysicsObstacle from "../physics/PhysicsObstacle";
import PhysicsCollectible from "../physics/PhysicsCollectible";
import ScoreHUD from "../physics/ScoreHUD";

interface PlatformSceneProps {
  modelUrl?: string;
  onScore?: (score: number) => void;
  color?: string;
}

export default function PlatformScene({
  modelUrl,
  onScore,
  color = "#44bb88",
}: PlatformSceneProps) {
  const [score, setScore] = useState(0);

  const collect = useCallback(() => {
    setScore((prev) => {
      const next = prev + 100;
      onScore?.(next);
      return next;
    });
  }, [onScore]);

  // Generate platform layout
  const platforms = useMemo(() => {
    const arr: {
      id: number;
      pos: [number, number, number];
      size: [number, number, number];
      moving?: boolean;
    }[] = [];
    let id = 0;

    // Ground
    arr.push({ id: id++, pos: [0, -1, 0], size: [30, 0.5, 4], moving: false });

    // Staircase of platforms
    for (let i = 0; i < 8; i++) {
      const x = -8 + i * 3;
      const y = 0.5 + i * 1.5;
      arr.push({
        id: id++,
        pos: [x, y, 0],
        size: [2.5, 0.4, 2],
        moving: i % 3 === 0,
      });
    }

    // Floating platforms on the other side
    for (let i = 0; i < 5; i++) {
      arr.push({
        id: id++,
        pos: [10 - i * 3, 3 + i * 1.2, 0],
        size: [2, 0.4, 2],
        moving: i % 2 === 1,
      });
    }

    return arr;
  }, []);

  const collectibles = useMemo(() => {
    return platforms
      .filter((p) => p.pos[1] > 0)
      .map((p, i) => ({
        id: i + 5000,
        position: [p.pos[0], p.pos[1] + 1, 0] as [number, number, number],
      }));
  }, [platforms]);

  return (
    <Physics gravity={[0, -12, 0]}>
      <ambientLight intensity={0.35} />
      <directionalLight position={[6, 10, 4]} intensity={0.9} castShadow />
      <directionalLight position={[-4, 4, -3]} intensity={0.2} color="#88aaff" />
      <hemisphereLight
        color="#ffe0b2"
        groundColor="#1a1a2e"
        intensity={0.3}
      />

      {/* In-scene score */}
      <ScoreHUD score={score} label="Platform" />

      {/* Player */}
      <PhysicsCharacter
        modelUrl={modelUrl}
        position={[-8, 2, 0]}
        speed={5}
        jumpForce={8}
        color={color}
        moveAxes="xy"
        modelScale={0.65}
      />

      {/* Platforms */}
      {platforms.map((p) => (
        <PhysicsObstacle
          key={p.id}
          position={p.pos}
          size={p.size}
          color={p.pos[1] < 0 ? "#2d3748" : "#4a5568"}
          variant={p.pos[1] < 0 ? "ground" : "platform"}
          moveAmplitude={p.moving ? 1.5 : 0}
          moveAxis="x"
          moveSpeed={0.8}
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
    </Physics>
  );
}
