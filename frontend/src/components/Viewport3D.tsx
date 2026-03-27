import React, { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import MuJoCoModel from "./MuJoCoModel";

export default function Viewport3D() {
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
      </Suspense>
      <Grid
        args={[10, 10]}
        cellSize={0.05}
        sectionSize={0.25}
        fadeDistance={5}
        position={[0, 0, 0]}
      />
      <OrbitControls makeDefault />
    </Canvas>
  );
}
