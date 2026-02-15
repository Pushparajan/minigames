/**
 * PhysicsObstacle — A static or kinematic rigid body for level geometry.
 *
 * Can be used as ground, walls, platforms, or moving obstacles depending
 * on the `variant` prop.
 */

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";

type ObstacleVariant = "ground" | "wall" | "platform" | "obstacle";

interface PhysicsObstacleProps {
  position?: [number, number, number];
  size?: [number, number, number];
  color?: string;
  variant?: ObstacleVariant;
  /** For kinematic obstacles: amplitude of back-and-forth motion. */
  moveAmplitude?: number;
  /** Axis of kinematic motion. */
  moveAxis?: "x" | "y" | "z";
  /** Speed of kinematic motion. */
  moveSpeed?: number;
}

export default function PhysicsObstacle({
  position = [0, 0, 0],
  size = [4, 0.5, 4],
  color = "#334466",
  variant = "ground",
  moveAmplitude = 0,
  moveAxis = "x",
  moveSpeed = 1,
}: PhysicsObstacleProps) {
  const rigidBody = useRef<RapierRigidBody>(null!);
  const isKinematic = moveAmplitude > 0;
  // Store start position as a plain tuple to avoid allocating THREE.Vector3
  const startX = useRef(position[0]);
  const startY = useRef(position[1]);
  const startZ = useRef(position[2]);

  useFrame((state) => {
    if (!isKinematic || !rigidBody.current) return;
    const t = state.clock.elapsedTime;
    const offset = Math.sin(t * moveSpeed) * moveAmplitude;

    // Reuse a plain object instead of cloning a Vector3 every frame
    const x = startX.current + (moveAxis === "x" ? offset : 0);
    const y = startY.current + (moveAxis === "y" ? offset : 0);
    const z = startZ.current + (moveAxis === "z" ? offset : 0);

    rigidBody.current.setNextKinematicTranslation({ x, y, z });
  });

  return (
    <RigidBody
      ref={rigidBody}
      type={isKinematic ? "kinematicPosition" : "fixed"}
      position={position}
      colliders={false}
      userData={{ type: variant }}
    >
      <CuboidCollider args={[size[0] / 2, size[1] / 2, size[2] / 2]} />
      <mesh castShadow receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.1} />
      </mesh>
    </RigidBody>
  );
}
