/**
 * PhysicsCollectible — A glowing, spinning collectible with a sensor
 * collider.  When the player touches it, it calls `onCollect` and
 * disappears.
 */

import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { RigidBody, BallCollider } from "@react-three/rapier";
import * as THREE from "three";

interface PhysicsCollectibleProps {
  position?: [number, number, number];
  color?: string;
  size?: number;
  onCollect?: () => void;
}

export default function PhysicsCollectible({
  position = [0, 1, 0],
  color = "#ffcc00",
  size = 0.2,
  onCollect,
}: PhysicsCollectibleProps) {
  const mesh = useRef<THREE.Mesh>(null!);
  const [collected, setCollected] = useState(false);

  useFrame((state) => {
    if (!mesh.current || collected) return;
    const t = state.clock.elapsedTime;
    // Spin + hover
    mesh.current.rotation.y = t * 2;
    mesh.current.position.y = Math.sin(t * 3) * 0.1;
  });

  if (collected) return null;

  return (
    <RigidBody
      type="fixed"
      position={position}
      colliders={false}
      sensor
      userData={{ type: "collectible" }}
      onIntersectionEnter={({ other }) => {
        const ud = other.rigidBody?.userData as
          | Record<string, string>
          | undefined;
        if (ud?.type === "player") {
          setCollected(true);
          onCollect?.();
        }
      }}
    >
      <BallCollider args={[size * 1.5]} sensor />
      <mesh ref={mesh} castShadow>
        <dodecahedronGeometry args={[size, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.4}
          roughness={0.2}
          metalness={0.6}
        />
      </mesh>
    </RigidBody>
  );
}
