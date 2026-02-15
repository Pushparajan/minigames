/**
 * ScoreHUD — An in-scene 3D text HUD that displays the current score
 * and optional controls hint.  Renders as a billboard sprite using
 * drei's Html component so it always faces the camera.
 */

import { Html } from "@react-three/drei";

interface ScoreHUDProps {
  score: number;
  label?: string;
}

export default function ScoreHUD({ score, label }: ScoreHUDProps) {
  return (
    <Html
      position={[0, 8, 0]}
      center
      distanceFactor={15}
      style={{ pointerEvents: "none", userSelect: "none" }}
    >
      <div
        style={{
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(6px)",
          borderRadius: 12,
          padding: "8px 20px",
          color: "#fff",
          fontFamily: "'Inter', system-ui, sans-serif",
          textAlign: "center",
          whiteSpace: "nowrap",
        }}
      >
        {label && (
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>
            {label}
          </div>
        )}
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 1 }}>
          {score.toLocaleString()}
        </div>
        <div style={{ fontSize: 9, opacity: 0.5, marginTop: 4 }}>
          WASD / Arrows to move &middot; Space to jump
        </div>
      </div>
    </Html>
  );
}
