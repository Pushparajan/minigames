/**
 * DefaultPixarCharacter — A procedural 3-D Pixar-style character built
 * entirely from Three.js primitives.  Used as a fallback when the player
 * hasn't uploaded a .glb model.
 *
 * Anatomy: capsule body, two big white eyes with black pupils and
 * specular highlights, two soft blush spheres on the cheeks.
 */

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface Props {
  color?: string;
  scale?: number;
}

export default function DefaultPixarCharacter({
  color = "#4488ff",
  scale = 1,
}: Props) {
  const group = useRef<THREE.Group>(null!);
  const leftPupil = useRef<THREE.Mesh>(null!);
  const rightPupil = useRef<THREE.Mesh>(null!);

  // Subtle idle animation: gentle breathing + eye look
  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // Breathing: slight vertical scale oscillation
    if (group.current) {
      group.current.scale.setScalar(scale * (1 + Math.sin(t * 2) * 0.015));
    }

    // Pupils follow a lazy figure-8 pattern
    const px = Math.sin(t * 0.8) * 0.02;
    const py = Math.sin(t * 1.6) * 0.01;
    if (leftPupil.current) {
      leftPupil.current.position.x = -0.12 + px;
      leftPupil.current.position.y = 0.55 + py;
    }
    if (rightPupil.current) {
      rightPupil.current.position.x = 0.12 + px;
      rightPupil.current.position.y = 0.55 + py;
    }
  });

  return (
    <group ref={group}>
      {/* Body — capsule shape */}
      <mesh position={[0, 0.35, 0]} castShadow>
        <capsuleGeometry args={[0.28, 0.4, 8, 16]} />
        <meshStandardMaterial
          color={color}
          roughness={0.35}
          metalness={0.05}
        />
      </mesh>

      {/* ---- Left eye ---- */}
      {/* Sclera */}
      <mesh position={[-0.12, 0.55, 0.22]}>
        <sphereGeometry args={[0.09, 16, 16]} />
        <meshStandardMaterial color="white" roughness={0.2} />
      </mesh>
      {/* Pupil */}
      <mesh ref={leftPupil} position={[-0.12, 0.55, 0.3]}>
        <sphereGeometry args={[0.045, 12, 12]} />
        <meshStandardMaterial color="#111111" roughness={0.1} />
      </mesh>
      {/* Specular highlight */}
      <mesh position={[-0.1, 0.57, 0.31]}>
        <sphereGeometry args={[0.015, 8, 8]} />
        <meshBasicMaterial color="white" />
      </mesh>

      {/* ---- Right eye ---- */}
      {/* Sclera */}
      <mesh position={[0.12, 0.55, 0.22]}>
        <sphereGeometry args={[0.09, 16, 16]} />
        <meshStandardMaterial color="white" roughness={0.2} />
      </mesh>
      {/* Pupil */}
      <mesh ref={rightPupil} position={[0.12, 0.55, 0.3]}>
        <sphereGeometry args={[0.045, 12, 12]} />
        <meshStandardMaterial color="#111111" roughness={0.1} />
      </mesh>
      {/* Specular highlight */}
      <mesh position={[0.14, 0.57, 0.31]}>
        <sphereGeometry args={[0.015, 8, 8]} />
        <meshBasicMaterial color="white" />
      </mesh>

      {/* ---- Blush cheeks ---- */}
      <mesh position={[-0.2, 0.42, 0.18]}>
        <sphereGeometry args={[0.055, 12, 12]} />
        <meshStandardMaterial
          color="#ff8899"
          transparent
          opacity={0.45}
          roughness={0.8}
        />
      </mesh>
      <mesh position={[0.2, 0.42, 0.18]}>
        <sphereGeometry args={[0.055, 12, 12]} />
        <meshStandardMaterial
          color="#ff8899"
          transparent
          opacity={0.45}
          roughness={0.8}
        />
      </mesh>

      {/* Small smile arc (flat torus) */}
      <mesh position={[0, 0.4, 0.26]} rotation={[0.3, 0, 0]}>
        <torusGeometry args={[0.06, 0.012, 8, 16, Math.PI]} />
        <meshStandardMaterial color="#cc3355" roughness={0.4} />
      </mesh>
    </group>
  );
}
