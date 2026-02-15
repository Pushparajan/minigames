/**
 * CharacterModel — loads a .glb file via R3F / drei, auto-scales it to
 * fit the viewport, and plays the first available animation clip.
 */

import { useRef, useEffect, useMemo } from "react";
import { useGLTF, useAnimations } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface CharacterModelProps {
  /** Blob URL (or HTTP URL) pointing to a .glb file. */
  url: string;
  /** Slowly spin the model around the Y axis. */
  autoRotate?: boolean;
  /** Normalise the model so its largest dimension equals `targetSize`. */
  autoScale?: boolean;
  /** World-units the model should fit inside (default 2). */
  targetSize?: number;
  /** Override position. */
  position?: [number, number, number];
}

export default function CharacterModel({
  url,
  autoRotate = false,
  autoScale = true,
  targetSize = 2,
  position = [0, 0, 0],
}: CharacterModelProps) {
  const group = useRef<THREE.Group>(null!);
  const { scene, animations } = useGLTF(url);

  /* ---------- Clone the scene (supports skeletons / skinned meshes) --- */

  const cloned = useMemo(() => {
    // Deep-clone the scene graph.  For skinned meshes the built-in
    // clone() handles bones correctly since Three r150+.
    const c = scene.clone(true);

    // Clone materials so tint/visibility changes are independent.
    c.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        const mesh = node as THREE.Mesh;
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((m) => m.clone());
        } else {
          mesh.material = mesh.material.clone();
        }
      }
    });

    return c;
  }, [scene]);

  /* ---------- Auto-scale & center ------------------------------------ */

  useEffect(() => {
    if (!autoScale) return;

    const box = new THREE.Box3().setFromObject(cloned);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
      const s = targetSize / maxDim;
      cloned.scale.setScalar(s);
      // Position so the model's feet sit at y = 0
      cloned.position.set(
        -center.x * s,
        -box.min.y * s,
        -center.z * s,
      );
    }
  }, [cloned, autoScale, targetSize]);

  /* ---------- Play first animation clip ------------------------------ */

  const { actions, names } = useAnimations(animations, group);

  useEffect(() => {
    if (names.length === 0) return;
    const action = actions[names[0]];
    action?.reset().fadeIn(0.3).play();
    return () => {
      action?.fadeOut(0.3);
    };
  }, [actions, names]);

  /* ---------- Auto-rotate -------------------------------------------- */

  useFrame((_, delta) => {
    if (autoRotate && group.current) {
      group.current.rotation.y += delta * 0.5;
    }
  });

  /* ---------- Render ------------------------------------------------- */

  return (
    <group ref={group} position={position}>
      <primitive object={cloned} />
    </group>
  );
}
