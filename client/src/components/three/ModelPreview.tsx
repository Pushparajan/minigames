/**
 * ModelPreview — self-contained R3F canvas that shows a .glb model
 * with orbit controls, three-point lighting, a ground shadow, and the
 * model's first animation playing.
 *
 * Used inside the AssetUploader to give an instant 3-D preview after
 * the user selects a .glb file.
 */

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, ContactShadows } from "@react-three/drei";
import CharacterModel from "./CharacterModel";

interface ModelPreviewProps {
  /** Blob URL (or HTTP URL) of a .glb file. */
  url: string;
  /** Height in CSS pixels (default 220). */
  height?: number;
}

/** Fallback while the model loads. */
function Loader() {
  return (
    <mesh>
      <sphereGeometry args={[0.3, 16, 16]} />
      <meshStandardMaterial color="#4444aa" wireframe />
    </mesh>
  );
}

export default function ModelPreview({ url, height = 220 }: ModelPreviewProps) {
  return (
    <div
      style={{
        width: "100%",
        height,
        borderRadius: 8,
        overflow: "hidden",
        background: "radial-gradient(ellipse at 50% 30%, #1e1e3a 0%, #0c0c1a 100%)",
        marginTop: 10,
        border: "1px solid #2a2a4a",
      }}
    >
      <Canvas
        camera={{ position: [0, 1.2, 3.2], fov: 45 }}
        shadows
        gl={{ antialias: true, alpha: true }}
      >
        {/* --- Three-point lighting --- */}
        <ambientLight intensity={0.35} />
        <directionalLight
          position={[4, 6, 4]}
          intensity={0.9}
          castShadow
          shadow-mapSize={[512, 512]}
        />
        <directionalLight position={[-3, 3, -4]} intensity={0.3} color="#6688ff" />
        <pointLight position={[0, -1, 3]} intensity={0.15} color="#ff8844" />

        {/* --- Model --- */}
        <Suspense fallback={<Loader />}>
          <CharacterModel url={url} autoRotate autoScale targetSize={1.8} />
          <ContactShadows
            position={[0, -0.01, 0]}
            opacity={0.45}
            scale={4}
            blur={2.5}
            far={3}
          />
        </Suspense>

        {/* --- Orbit controls --- */}
        <OrbitControls
          makeDefault
          enablePan={false}
          minDistance={1.5}
          maxDistance={6}
          minPolarAngle={0.3}
          maxPolarAngle={Math.PI / 2 + 0.15}
        />
      </Canvas>
    </div>
  );
}
