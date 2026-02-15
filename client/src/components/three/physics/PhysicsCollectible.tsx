/**
 * PhysicsCollectible — A glowing, spinning collectible with a sensor
 * collider.  When the player touches it, it plays a quick scale-up
 * fade-out animation before disappearing.
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
  const mat = useRef<THREE.MeshStandardMaterial>(null!);
  const [collected, setCollected] = useState(false);
  const [gone, setGone] = useState(false);
  // Track the collection animation progress (0 = just collected, 1 = done)
  const animProgress = useRef(0);

  useFrame((state, delta) => {
    if (!mesh.current) return;

    if (collected) {
      // Scale-up + fade-out collection feedback
      animProgress.current += delta * 4; // ~0.25s animation
      const t = Math.min(animProgress.current, 1);
      const scale = 1 + t * 1.5; // grows 2.5x
      mesh.current.scale.setScalar(scale);
      if (mat.current) {
        mat.current.opacity = 1 - t;
      }
      if (t >= 1) {
        setGone(true);
      }
      return;
    }

    const t = state.clock.elapsedTime;
    // Spin + hover
    mesh.current.rotation.y = t * 2;
    mesh.current.position.y = Math.sin(t * 3) * 0.1;
  });

  if (gone) return null;

  return (
    <RigidBody
      type="fixed"
      position={position}
      colliders={false}
      sensor
      userData={{ type: "collectible" }}
      onIntersectionEnter={({ other }) => {
        if (collected) return;
        const ud = other.rigidBody?.userData as
          | Record<string, string>
          | undefined;
        if (ud?.type === "player") {
          setCollected(true);
          animProgress.current = 0;
          onCollect?.();
        }
      }}
    >
      <BallCollider args={[size * 1.5]} sensor />
      <mesh ref={mesh} castShadow>
        <dodecahedronGeometry args={[size, 0]} />
        <meshStandardMaterial
          ref={mat}
          color={color}
          emissive={color}
          emissiveIntensity={collected ? 1.2 : 0.4}
          roughness={0.2}
          metalness={0.6}
          transparent
        />
      </mesh>
    </RigidBody>
  );
}
