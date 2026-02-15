/**
 * ArenaScene — Top-down arena / shooter.
 *
 * The player moves on the XZ plane and shoots projectiles.  Enemies
 * are placed around the arena as fixed targets.
 *
 * Games: PeriodicInvaders, WeatherDefense, AtomSmasher
 */

import { useState, useCallback, useMemo } from "react";
import { Physics } from "@react-three/rapier";
import PhysicsCharacter from "../physics/PhysicsCharacter";
import PhysicsObstacle from "../physics/PhysicsObstacle";
import PhysicsCollectible from "../physics/PhysicsCollectible";
import DefaultPixarCharacter from "../physics/DefaultPixarCharacter";
import ScoreHUD from "../physics/ScoreHUD";
import { RigidBody, BallCollider } from "@react-three/rapier";

interface ArenaSceneProps {
  modelUrl?: string;
  onScore?: (score: number) => void;
  color?: string;
}

interface EnemyDef {
  id: number;
  position: [number, number, number];
  color: string;
}

export default function ArenaScene({
  modelUrl,
  onScore,
  color = "#4488ff",
}: ArenaSceneProps) {
  const [score, setScore] = useState(0);
  const [defeatedEnemies, setDefeatedEnemies] = useState<Set<number>>(
    new Set(),
  );

  const collect = useCallback(() => {
    setScore((prev) => {
      const next = prev + 50;
      onScore?.(next);
      return next;
    });
  }, [onScore]);

  const enemies = useMemo<EnemyDef[]>(() => {
    const arr: EnemyDef[] = [];
    const colors = ["#ff4444", "#ff6644", "#cc3366", "#ff8833"];
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const radius = 5 + Math.random() * 3;
      arr.push({
        id: i,
        position: [
          Math.cos(angle) * radius,
          0.5,
          Math.sin(angle) * radius,
        ],
        color: colors[i % colors.length],
      });
    }
    return arr;
  }, []);

  const collectibles = useMemo(() => {
    const arr: { id: number; position: [number, number, number] }[] = [];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + 0.4;
      arr.push({
        id: i + 100,
        position: [Math.cos(angle) * 3, 0.5, Math.sin(angle) * 3],
      });
    }
    return arr;
  }, []);

  return (
    <Physics gravity={[0, -9.81, 0]}>
      <ambientLight intensity={0.45} />
      <directionalLight position={[8, 12, 6]} intensity={0.85} castShadow />
      <directionalLight position={[-4, 6, -6]} intensity={0.3} color="#8866ff" />
      <pointLight position={[0, 8, 0]} intensity={0.3} color="#ff8844" />

      {/* In-scene score */}
      <ScoreHUD score={score} label="Arena" />

      {/* Player */}
      <PhysicsCharacter
        modelUrl={modelUrl}
        position={[0, 1, 0]}
        speed={5}
        jumpForce={5}
        color={color}
        moveAxes="xz"
        modelScale={0.7}
      />

      {/* Arena floor */}
      <PhysicsObstacle
        position={[0, -0.25, 0]}
        size={[24, 0.5, 24]}
        color="#1e293b"
        variant="ground"
      />

      {/* Arena walls */}
      <PhysicsObstacle position={[12, 2, 0]} size={[0.5, 4, 24]} color="#334155" variant="wall" />
      <PhysicsObstacle position={[-12, 2, 0]} size={[0.5, 4, 24]} color="#334155" variant="wall" />
      <PhysicsObstacle position={[0, 2, 12]} size={[24, 4, 0.5]} color="#334155" variant="wall" />
      <PhysicsObstacle position={[0, 2, -12]} size={[24, 4, 0.5]} color="#334155" variant="wall" />

      {/* Enemies (static Pixar characters) */}
      {enemies.map(
        (e) =>
          !defeatedEnemies.has(e.id) && (
            <RigidBody
              key={e.id}
              type="fixed"
              position={e.position}
              colliders={false}
              userData={{ type: "enemy" }}
              onCollisionEnter={({ other }) => {
                const ud = other.rigidBody?.userData as
                  | Record<string, string>
                  | undefined;
                if (ud?.type === "projectile" || ud?.type === "player") {
                  setDefeatedEnemies((prev) => new Set(prev).add(e.id));
                  setScore((prev) => {
                    const next = prev + 200;
                    onScore?.(next);
                    return next;
                  });
                }
              }}
            >
              <BallCollider args={[0.35]} position={[0, 0.35, 0]} />
              <DefaultPixarCharacter color={e.color} scale={0.6} />
            </RigidBody>
          ),
      )}

      {/* Collectibles */}
      {collectibles.map((c) => (
        <PhysicsCollectible
          key={c.id}
          position={c.position}
          onCollect={collect}
          color="#44ddff"
        />
      ))}
    </Physics>
  );
}
