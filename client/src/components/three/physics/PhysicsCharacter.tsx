/**
 * PhysicsCharacter — A Rapier-driven player character.
 *
 * Wraps either an uploaded .glb `CharacterModel` or the built-in
 * `DefaultPixarCharacter` in a dynamic RigidBody with keyboard input.
 *
 * Movement: Arrow keys / WASD for horizontal movement, Space to jump.
 * The character uses velocity-based control with ground detection.
 */

import { useRef, useEffect, useState, Suspense } from "react";
import { useFrame } from "@react-three/fiber";
import { RigidBody, CapsuleCollider } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import CharacterModel from "../CharacterModel";
import DefaultPixarCharacter from "./DefaultPixarCharacter";

interface PhysicsCharacterProps {
  /** Blob/HTTP URL for a .glb model (optional — uses default if absent). */
  modelUrl?: string;
  /** Starting position [x, y, z]. */
  position?: [number, number, number];
  /** Movement speed (units / second). */
  speed?: number;
  /** Jump impulse strength. */
  jumpForce?: number;
  /** Character colour (used for the default character). */
  color?: string;
  /** Movement axes: "xy" for side-scrollers, "xz" for top-down. */
  moveAxes?: "xy" | "xz";
  /** Scale of the visual model. */
  modelScale?: number;
}

// Key state tracked outside React renders for low-latency input
const keys = new Set<string>();

function handleKeyDown(e: KeyboardEvent) {
  keys.add(e.code);
}
function handleKeyUp(e: KeyboardEvent) {
  keys.delete(e.code);
}

export default function PhysicsCharacter({
  modelUrl,
  position = [0, 2, 0],
  speed = 5,
  jumpForce = 6,
  color = "#4488ff",
  moveAxes = "xz",
  modelScale = 0.8,
}: PhysicsCharacterProps) {
  const rigidBody = useRef<RapierRigidBody>(null!);
  const [grounded, setGrounded] = useState(false);

  // Register global key listeners once
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      keys.clear();
    };
  }, []);

  // Every frame: read keys → set velocity
  useFrame(() => {
    if (!rigidBody.current) return;
    const vel = rigidBody.current.linvel();

    let moveX = 0;
    let moveZ = 0;

    if (keys.has("ArrowLeft") || keys.has("KeyA")) moveX -= 1;
    if (keys.has("ArrowRight") || keys.has("KeyD")) moveX += 1;
    if (keys.has("ArrowUp") || keys.has("KeyW")) moveZ -= 1;
    if (keys.has("ArrowDown") || keys.has("KeyS")) moveZ += 1;

    // Normalise diagonal movement
    const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
    if (len > 0) {
      moveX = (moveX / len) * speed;
      moveZ = (moveZ / len) * speed;
    }

    if (moveAxes === "xy") {
      // Side-scroller: X horizontal, Y vertical (gravity), Z unused
      let moveY = 0;
      if (keys.has("ArrowUp") || keys.has("KeyW")) moveY = 1;
      if (keys.has("ArrowDown") || keys.has("KeyS")) moveY = -1;

      rigidBody.current.setLinvel(
        { x: moveX * speed, y: vel.y, z: 0 },
        true,
      );

      // Jump
      if (
        (keys.has("Space") || moveY > 0) &&
        grounded
      ) {
        rigidBody.current.setLinvel(
          { x: vel.x, y: jumpForce, z: 0 },
          true,
        );
        setGrounded(false);
      }
    } else {
      // Top-down / 3D: XZ plane movement
      rigidBody.current.setLinvel(
        { x: moveX, y: vel.y, z: moveZ },
        true,
      );

      // Jump
      if (keys.has("Space") && grounded) {
        rigidBody.current.setLinvel(
          { x: vel.x, y: jumpForce, z: vel.z },
          true,
        );
        setGrounded(false);
      }
    }
  });

  return (
    <RigidBody
      ref={rigidBody}
      type="dynamic"
      position={position}
      lockRotations
      colliders={false}
      onCollisionEnter={({ other }) => {
        // Detect ground contact
        const ud = other.rigidBody?.userData as
          | Record<string, string>
          | undefined;
        if (ud?.type === "ground" || ud?.type === "platform") {
          setGrounded(true);
        }
      }}
      userData={{ type: "player" }}
    >
      <CapsuleCollider args={[0.3, 0.28]} position={[0, 0.58, 0]} />

      {/* Visual — either uploaded .glb or default Pixar character */}
      <Suspense fallback={null}>
        {modelUrl ? (
          <CharacterModel
            url={modelUrl}
            autoScale
            targetSize={modelScale}
          />
        ) : (
          <DefaultPixarCharacter color={color} scale={modelScale} />
        )}
      </Suspense>
    </RigidBody>
  );
}
