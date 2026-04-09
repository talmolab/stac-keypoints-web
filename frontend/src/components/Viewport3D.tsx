import React, { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import MuJoCoModel from "./MuJoCoModel";
import ACMSkeleton from "./ACMSkeleton";
import ModelGizmo from "./ModelGizmo";
import HoverTooltip from "./HoverTooltip";
import ErrorLines from "./ErrorLines";
import FollowCamera from "./FollowCamera";
import { CameraKeyboardControls } from "../hooks/useCameraControls";
import { useStore } from "../store";

/** Grid that adapts cell/section size to the data scale. */
function AdaptiveGrid() {
  const positions = useStore((s) => s.acmPositions);
  const numKp = useStore((s) => s.acmNumKeypoints);
  const mocapScale = useStore((s) => s.mocapScaleFactor);

  const { cellSize, sectionSize, fadeDistance } = useMemo(() => {
    if (!positions || numKp === 0) return { cellSize: 0.05, sectionSize: 0.25, fadeDistance: 3 };
    // Estimate data extent from frame 0
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < numKp; i++) {
      const x = positions[i * 3 + 0] * mocapScale;
      const y = positions[i * 3 + 1] * mocapScale;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const extent = Math.max(maxX - minX, maxY - minY, 0.01);
    return {
      cellSize: extent * 0.1,
      sectionSize: extent * 0.5,
      fadeDistance: extent * 10,
    };
  }, [positions, numKp, mocapScale]);

  return (
    <Grid
      args={[2, 2]}
      cellSize={cellSize}
      sectionSize={sectionSize}
      fadeDistance={fadeDistance}
      cellColor="#333344"
      sectionColor="#444466"
      position={[0, 0, 0]}
      infiniteGrid
    />
  );
}

export default function Viewport3D() {
  const showGlobalControls = useStore((s) => s.showGlobalControls);
  return (
    <Canvas
      camera={{ position: [0.5, 0.3, 0.5], fov: 45, near: 0.001, far: 100 }}
      style={{ background: "#1a1a2e" }}
    >
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 5, 5]} intensity={0.8} />
      <directionalLight position={[-3, 3, -3]} intensity={0.3} />
      <Suspense fallback={null}>
        <MuJoCoModel />
        <ACMSkeleton />
        {showGlobalControls && <ModelGizmo />}
        <HoverTooltip />
        <ErrorLines />
      </Suspense>
      <AdaptiveGrid />
      <OrbitControls makeDefault />
      <CameraKeyboardControls />
      <FollowCamera />
    </Canvas>
  );
}
