/**
 * PhysicsProjectile — A dynamic rigid body that travels in a direction
 * and calls `onHit` when it collides with a target.
 */

import { useRef, useEffect, useState } from "react";
import { RigidBody, BallCollider } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";

interface PhysicsProjectileProps {
  position: [number, number, number];
  velocity: [number, number, number];
  color?: string;
  size?: number;
  onHit?: (targetType: string) => void;
  /** Auto-destroy after this many seconds. */
  lifetime?: number;
}

export default function PhysicsProjectile({
  position,
  velocity,
  color = "#ff6644",
  size = 0.12,
  onHit,
  lifetime = 4,
}: PhysicsProjectileProps) {
  const rigidBody = useRef<RapierRigidBody>(null!);
  const [alive, setAlive] = useState(true);

  // Apply initial velocity once
  useEffect(() => {
    if (rigidBody.current) {
      rigidBody.current.setLinvel(
        { x: velocity[0], y: velocity[1], z: velocity[2] },
        true,
      );
    }

    const timer = setTimeout(() => setAlive(false), lifetime * 1000);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!alive) return null;

  return (
    <RigidBody
      ref={rigidBody}
      type="dynamic"
      position={position}
      colliders={false}
      gravityScale={0.1}
      userData={{ type: "projectile" }}
      onCollisionEnter={({ other }) => {
        const ud = other.rigidBody?.userData as
          | Record<string, string>
          | undefined;
        if (ud?.type && ud.type !== "player" && ud.type !== "projectile") {
          onHit?.(ud.type);
          setAlive(false);
        }
      }}
    >
      <BallCollider args={[size]} />
      <mesh castShadow>
        <sphereGeometry args={[size, 12, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.6}
          roughness={0.2}
        />
      </mesh>
    </RigidBody>
  );
}
