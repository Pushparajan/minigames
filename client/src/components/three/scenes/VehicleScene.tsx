/**
 * VehicleScene — Top-down vehicle driving with physics.
 *
 * The player controls a vehicle body that applies forces for
 * acceleration and torque for steering.  Obstacles and collectibles
 * are placed along a track.
 *
 * Games: VoltageRacer, RocketLabLander, GravityGolfPlanets
 */

import { useRef, useState, useCallback, useMemo, useEffect, Suspense } from "react";
import { useFrame } from "@react-three/fiber";
import { Physics, RigidBody, CuboidCollider } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import PhysicsObstacle from "../physics/PhysicsObstacle";
import PhysicsCollectible from "../physics/PhysicsCollectible";
import DefaultPixarCharacter from "../physics/DefaultPixarCharacter";
import ScoreHUD from "../physics/ScoreHUD";
import CharacterModel from "../CharacterModel";

interface VehicleSceneProps {
  modelUrl?: string;
  onScore?: (score: number) => void;
  color?: string;
}

function VehicleBody({
  modelUrl,
  color,
}: {
  modelUrl?: string;
  color: string;
}) {
  const ref = useRef<RapierRigidBody>(null!);
  const keysRef = useRef(new Set<string>());

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

  useFrame(() => {
    if (!ref.current) return;
    const keys = keysRef.current;

    let thrust = 0;
    let torque = 0;
    const power = 0.15;
    const turnPower = 0.04;

    if (keys.has("ArrowUp") || keys.has("KeyW")) thrust += power;
    if (keys.has("ArrowDown") || keys.has("KeyS")) thrust -= power * 0.6;
    if (keys.has("ArrowLeft") || keys.has("KeyA")) torque += turnPower;
    if (keys.has("ArrowRight") || keys.has("KeyD")) torque -= turnPower;

    if (thrust !== 0) {
      // Apply force in the local forward direction
      const rot = ref.current.rotation();
      const angle = 2 * Math.atan2(rot.y, rot.w);
      const fx = -Math.sin(angle) * thrust;
      const fz = -Math.cos(angle) * thrust;
      ref.current.applyImpulse({ x: fx, y: 0, z: fz }, true);
    }
    if (torque !== 0) {
      ref.current.applyTorqueImpulse({ x: 0, y: torque, z: 0 }, true);
    }
  });

  return (
    <RigidBody
      ref={ref}
      type="dynamic"
      position={[0, 0.6, 6]}
      colliders={false}
      linearDamping={1.2}
      angularDamping={3}
      userData={{ type: "player" }}
    >
      <CuboidCollider args={[0.4, 0.25, 0.6]} position={[0, 0.25, 0]} />
      {/* Vehicle visual: either model or default character riding a box */}
      <group>
        {/* Vehicle body */}
        <mesh position={[0, 0.15, 0]} castShadow>
          <boxGeometry args={[0.8, 0.35, 1.2]} />
          <meshStandardMaterial color={color} roughness={0.3} metalness={0.4} />
        </mesh>
        {/* Driver */}
        <group position={[0, 0.35, 0.1]} scale={0.4}>
          <Suspense fallback={null}>
            {modelUrl ? (
              <CharacterModel url={modelUrl} autoScale targetSize={0.8} />
            ) : (
              <DefaultPixarCharacter color={color} scale={0.8} />
            )}
          </Suspense>
        </group>
      </group>
    </RigidBody>
  );
}

export default function VehicleScene({
  modelUrl,
  onScore,
  color = "#ff6644",
}: VehicleSceneProps) {
  const [score, setScore] = useState(0);

  const collect = useCallback(() => {
    setScore((prev) => {
      const next = prev + 100;
      onScore?.(next);
      return next;
    });
  }, [onScore]);

  // Track barriers in an oval
  const barriers = useMemo(() => {
    const arr: { id: number; pos: [number, number, number]; size: [number, number, number] }[] = [];
    let id = 0;
    // Outer oval barriers
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      const rx = 10;
      const rz = 7;
      arr.push({
        id: id++,
        pos: [Math.cos(angle) * rx, 0.5, Math.sin(angle) * rz],
        size: [1.2, 1, 0.4],
      });
    }
    return arr;
  }, []);

  // Collectibles along the track
  const collectibles = useMemo(() => {
    const arr: { id: number; position: [number, number, number] }[] = [];
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      arr.push({
        id: i + 2000,
        position: [Math.cos(angle) * 6, 0.5, Math.sin(angle) * 4.5],
      });
    }
    return arr;
  }, []);

  return (
    <Physics gravity={[0, -9.81, 0]}>
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 12, 8]} intensity={0.9} castShadow />
      <directionalLight position={[-3, 6, -5]} intensity={0.25} color="#ffaa66" />

      {/* In-scene score */}
      <ScoreHUD score={score} label="Race" />

      {/* Ground / track surface */}
      <PhysicsObstacle
        position={[0, -0.15, 0]}
        size={[30, 0.3, 22]}
        color="#2a2a3a"
        variant="ground"
      />

      {/* Track barriers */}
      {barriers.map((b) => (
        <PhysicsObstacle
          key={b.id}
          position={b.pos}
          size={b.size}
          color="#ff4444"
          variant="wall"
        />
      ))}

      {/* Vehicle */}
      <VehicleBody modelUrl={modelUrl} color={color} />

      {/* Collectibles */}
      {collectibles.map((c) => (
        <PhysicsCollectible
          key={c.id}
          position={c.position}
          onCollect={collect}
          color="#44ff88"
        />
      ))}
    </Physics>
  );
}
