/**
 * GameOverlay3D — A floating 3-D character portrait rendered during
 * gameplay.  It appears in the bottom-left corner of the game view
 * whenever the player has uploaded a "hero" .glb model.
 *
 * The portrait shows the model slowly rotating with its first
 * animation playing — giving the 2-D game a Pixar-movie companion
 * feel (think Buzz Lightyear watching from the corner).
 */

import { Suspense, memo } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import CharacterModel from "./CharacterModel";
import { useModelUrls } from "../../stores/useAssetStore";

const PORTRAIT_STYLES: React.CSSProperties = {
  position: "absolute",
  bottom: 12,
  left: 12,
  width: 160,
  height: 160,
  borderRadius: 14,
  overflow: "hidden",
  border: "2px solid rgba(100, 108, 255, 0.5)",
  background: "radial-gradient(ellipse at 50% 30%, #1a1a36 0%, #0a0a18 100%)",
  boxShadow: "0 4px 24px rgba(0, 0, 0, 0.6)",
  zIndex: 10,
  pointerEvents: "none", // don't capture game clicks
};

const LABEL_STYLES: React.CSSProperties = {
  position: "absolute",
  bottom: 4,
  left: 0,
  right: 0,
  textAlign: "center",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "rgba(200, 200, 230, 0.6)",
  pointerEvents: "none",
};

function OverlayContent({ url }: { url: string }) {
  return (
    <Canvas
      camera={{ position: [0, 0.9, 2.6], fov: 40 }}
      gl={{ antialias: true, alpha: true }}
      style={{ pointerEvents: "none" }}
    >
      <ambientLight intensity={0.4} />
      <directionalLight position={[3, 5, 3]} intensity={0.8} />
      <directionalLight position={[-2, 2, -3]} intensity={0.25} color="#6688ff" />

      <Suspense fallback={null}>
        <CharacterModel
          url={url}
          autoRotate
          autoScale
          targetSize={1.4}
        />
        <ContactShadows
          position={[0, -0.01, 0]}
          opacity={0.35}
          scale={3}
          blur={2}
          far={2}
        />
      </Suspense>
    </Canvas>
  );
}

/**
 * Renders a small 3-D character portrait in the corner of the game
 * view.  Returns `null` (renders nothing) when no model is uploaded.
 */
function GameOverlay3D() {
  const models = useModelUrls();

  // Show the first available model, preferring "hero"
  const url =
    models.get("hero") ??
    models.get("enemy") ??
    [...models.values()][0];

  if (!url) return null;

  return (
    <div style={PORTRAIT_STYLES}>
      <OverlayContent url={url} />
      <span style={LABEL_STYLES}>your character</span>
    </div>
  );
}

export default memo(GameOverlay3D);
