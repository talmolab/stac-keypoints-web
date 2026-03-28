import React, { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import MuJoCoModel from "./MuJoCoModel";
import ACMSkeleton from "./ACMSkeleton";
import OffsetMarkers from "./OffsetMarkers";
import OffsetGizmo from "./OffsetGizmo";

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
        <ACMSkeleton />
        <OffsetMarkers />
        <OffsetGizmo />
      </Suspense>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]}>
        <planeGeometry args={[2, 2]} />
        <meshStandardMaterial color="#8b7355" roughness={0.9} metalness={0.0} />
      </mesh>
      <gridHelper args={[2, 20, "#666655", "#555544"]} position={[0, 0, 0]} />
      <OrbitControls makeDefault />
    </Canvas>
  );
}
