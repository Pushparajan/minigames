/**
 * BilliardScene — Overhead billiard / ball physics sandbox.
 *
 * Multiple dynamic balls on a flat table.  The player ball is controlled
 * with keyboard, others scatter on collision.
 *
 * Games: PhysicsMasterBilliards, AtomSmasher, MicrobeMatch
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Physics, RigidBody, BallCollider } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import PhysicsObstacle from "../physics/PhysicsObstacle";
import ScoreHUD from "../physics/ScoreHUD";

interface BilliardSceneProps {
  modelUrl?: string;
  onScore?: (score: number) => void;
  color?: string;
}

function CueBall({ color, keysRef }: { color: string; keysRef: React.RefObject<Set<string>> }) {
  const ref = useRef<RapierRigidBody>(null!);

  useFrame(() => {
    if (!ref.current || !keysRef.current) return;
    const keys = keysRef.current;
    let fx = 0;
    let fz = 0;
    const force = 3;

    if (keys.has("ArrowLeft") || keys.has("KeyA")) fx -= force;
    if (keys.has("ArrowRight") || keys.has("KeyD")) fx += force;
    if (keys.has("ArrowUp") || keys.has("KeyW")) fz -= force;
    if (keys.has("ArrowDown") || keys.has("KeyS")) fz += force;

    if (fx !== 0 || fz !== 0) {
      ref.current.applyImpulse({ x: fx * 0.02, y: 0, z: fz * 0.02 }, true);
    }
  });

  return (
    <RigidBody
      ref={ref}
      type="dynamic"
      position={[0, 0.3, 3]}
      colliders={false}
      linearDamping={1.5}
      angularDamping={1.5}
      userData={{ type: "player" }}
    >
      <BallCollider args={[0.25]} />
      <mesh castShadow>
        <sphereGeometry args={[0.25, 20, 20]} />
        <meshStandardMaterial color={color} roughness={0.15} metalness={0.3} />
      </mesh>
    </RigidBody>
  );
}

export default function BilliardScene({
  onScore,
  color = "#eeeeee",
}: BilliardSceneProps) {
  const [score, setScore] = useState(0);
  const keysRef = useRef(new Set<string>());

  // Properly register key listeners in useEffect (not useState!)
  useEffect(() => {
    const keys = keysRef.current;
    const down = (e: KeyboardEvent) => keys.add(e.code);
    const up = (e: KeyboardEvent) => keys.delete(e.code);
    const blur = () => keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      keys.clear();
    };
  }, []);

  // Target ball positions in a triangle rack
  const balls = useMemo(() => {
    const arr: { id: number; position: [number, number, number]; color: string }[] = [];
    const ballColors = [
      "#ff4444", "#ffaa00", "#4488ff", "#44bb44",
      "#9933cc", "#ff6600", "#cc2244", "#2266cc",
      "#44ccaa", "#dd5500", "#6644cc", "#22aa44",
      "#cc8833", "#ff3388", "#3388ff",
    ];
    let id = 0;
    // Rack 5 rows
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col <= row; col++) {
        const x = (col - row / 2) * 0.55;
        const z = -2 - row * 0.5;
        arr.push({
          id: id,
          position: [x, 0.3, z],
          color: ballColors[id % ballColors.length],
        });
        id++;
      }
    }
    return arr;
  }, []);

  const hitBall = useCallback(() => {
    setScore((prev) => {
      const next = prev + 50;
      onScore?.(next);
      return next;
    });
  }, [onScore]);

  return (
    <Physics gravity={[0, -9.81, 0]}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[0, 10, 5]} intensity={0.8} castShadow />
      <pointLight position={[0, 6, 0]} intensity={0.6} color="#ffffcc" />

      {/* In-scene score display */}
      <ScoreHUD score={score} label="Billiards" />

      {/* Table surface */}
      <PhysicsObstacle
        position={[0, 0, 0]}
        size={[8, 0.3, 12]}
        color="#1a5c2a"
        variant="ground"
      />

      {/* Table cushions */}
      <PhysicsObstacle position={[4.15, 0.5, 0]} size={[0.3, 0.6, 12]} color="#5c3a1a" variant="wall" />
      <PhysicsObstacle position={[-4.15, 0.5, 0]} size={[0.3, 0.6, 12]} color="#5c3a1a" variant="wall" />
      <PhysicsObstacle position={[0, 0.5, 6.15]} size={[8, 0.6, 0.3]} color="#5c3a1a" variant="wall" />
      <PhysicsObstacle position={[0, 0.5, -6.15]} size={[8, 0.6, 0.3]} color="#5c3a1a" variant="wall" />

      {/* Cue ball */}
      <CueBall color={color} keysRef={keysRef} />

      {/* Target balls */}
      {balls.map((b) => (
        <RigidBody
          key={b.id}
          type="dynamic"
          position={b.position}
          colliders={false}
          linearDamping={1.8}
          angularDamping={1.8}
          userData={{ type: "ball" }}
          onCollisionEnter={({ other }) => {
            const ud = other.rigidBody?.userData as
              | Record<string, string>
              | undefined;
            if (ud?.type === "player") {
              hitBall();
            }
          }}
        >
          <BallCollider args={[0.25]} />
          <mesh castShadow>
            <sphereGeometry args={[0.25, 20, 20]} />
            <meshStandardMaterial
              color={b.color}
              roughness={0.15}
              metalness={0.3}
            />
          </mesh>
        </RigidBody>
      ))}
    </Physics>
  );
}
