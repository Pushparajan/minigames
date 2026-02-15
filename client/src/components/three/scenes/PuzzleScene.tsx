/**
 * PuzzleScene — Physics-based puzzle sandbox where the player pushes
 * blocks, collects items, and explores an enclosed area.
 *
 * Games: NanoAssembler, GeneticBreeder, DNAStackAttack, StarMapper,
 *        BridgeEngineer, CircuitLabPinball, ChemistryBubblePop,
 *        EcoSnake, GeometryBreakout, GravityGolfPlanets, PhotonPong
 */

import { useState, useCallback, useMemo } from "react";
import { Physics, RigidBody, CuboidCollider } from "@react-three/rapier";
import PhysicsCharacter from "../physics/PhysicsCharacter";
import PhysicsObstacle from "../physics/PhysicsObstacle";
import PhysicsCollectible from "../physics/PhysicsCollectible";
import ScoreHUD from "../physics/ScoreHUD";

interface PuzzleSceneProps {
  modelUrl?: string;
  onScore?: (score: number) => void;
  color?: string;
}

export default function PuzzleScene({
  modelUrl,
  onScore,
  color = "#aa66ff",
}: PuzzleSceneProps) {
  const [score, setScore] = useState(0);

  const collect = useCallback(() => {
    setScore((prev) => {
      const next = prev + 150;
      onScore?.(next);
      return next;
    });
  }, [onScore]);

  // Pushable blocks placed in the puzzle area
  const blocks = useMemo(() => {
    const arr: { id: number; position: [number, number, number]; color: string }[] = [];
    const blockColors = ["#5566aa", "#aa6655", "#55aa66", "#aaaa55"];
    for (let i = 0; i < 8; i++) {
      arr.push({
        id: i,
        position: [
          -3 + (i % 4) * 2,
          0.5,
          -2 + Math.floor(i / 4) * 3,
        ],
        color: blockColors[i % blockColors.length],
      });
    }
    return arr;
  }, []);

  // Collectibles scattered behind blocks
  const collectibles = useMemo(() => {
    const arr: { id: number; position: [number, number, number] }[] = [];
    for (let i = 0; i < 6; i++) {
      arr.push({
        id: i + 3000,
        position: [
          -4 + i * 1.8,
          0.6,
          -3 + (i % 2) * 5,
        ],
      });
    }
    return arr;
  }, []);

  return (
    <Physics gravity={[0, -9.81, 0]}>
      <ambientLight intensity={0.45} />
      <directionalLight position={[4, 10, 6]} intensity={0.8} castShadow />
      <directionalLight position={[-3, 5, -4]} intensity={0.25} color="#aaccff" />
      <hemisphereLight color="#e0e0ff" groundColor="#1a1a2a" intensity={0.25} />

      {/* In-scene score */}
      <ScoreHUD score={score} label="Puzzle" />

      {/* Player */}
      <PhysicsCharacter
        modelUrl={modelUrl}
        position={[0, 1.5, 4]}
        speed={4}
        jumpForce={5}
        color={color}
        moveAxes="xz"
        modelScale={0.6}
      />

      {/* Floor */}
      <PhysicsObstacle
        position={[0, -0.25, 0]}
        size={[14, 0.5, 14]}
        color="#1e1e2e"
        variant="ground"
      />

      {/* Walls */}
      <PhysicsObstacle position={[7, 1.5, 0]} size={[0.5, 3, 14]} color="#2a2a4a" variant="wall" />
      <PhysicsObstacle position={[-7, 1.5, 0]} size={[0.5, 3, 14]} color="#2a2a4a" variant="wall" />
      <PhysicsObstacle position={[0, 1.5, 7]} size={[14, 3, 0.5]} color="#2a2a4a" variant="wall" />
      <PhysicsObstacle position={[0, 1.5, -7]} size={[14, 3, 0.5]} color="#2a2a4a" variant="wall" />

      {/* Pushable blocks (dynamic) */}
      {blocks.map((b) => (
        <RigidBody
          key={b.id}
          type="dynamic"
          position={b.position}
          colliders={false}
          linearDamping={2}
          angularDamping={4}
          userData={{ type: "obstacle" }}
        >
          <CuboidCollider args={[0.45, 0.45, 0.45]} />
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.9, 0.9, 0.9]} />
            <meshStandardMaterial
              color={b.color}
              roughness={0.4}
              metalness={0.15}
            />
          </mesh>
        </RigidBody>
      ))}

      {/* Collectibles */}
      {collectibles.map((c) => (
        <PhysicsCollectible
          key={c.id}
          position={c.position}
          onCollect={collect}
          color="#ffdd44"
        />
      ))}
    </Physics>
  );
}
