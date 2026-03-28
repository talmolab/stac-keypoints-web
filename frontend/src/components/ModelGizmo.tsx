import React, { useRef, useEffect } from "react";
import { TransformControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "../store";
import { mjToThree } from "../mujocoLoader";

/**
 * TransformControls gizmo for the global model position.
 * Renders a small invisible anchor at the model center that can be dragged.
 * Dragging updates modelPosition in the store.
 */
export default function ModelGizmo() {
  const modelPosition = useStore((s) => s.modelPosition);
  const setModelPosition = useStore((s) => s.setModelPosition);
  const bodyTransforms = useStore((s) => s.bodyTransforms);
  const mode = useStore((s) => s.mode);
  const meshRef = useRef<THREE.Mesh>(null!);
  const controlsRef = useRef<any>(null);
  const { controls } = useThree();

  // Disable orbit controls while dragging
  useEffect(() => {
    const ctrl = controlsRef.current;
    if (!ctrl) return;
    const onDragChanged = (event: any) => {
      if (controls) (controls as any).enabled = !event.value;
    };
    ctrl.addEventListener("dragging-changed", onDragChanged);
    return () => ctrl.removeEventListener("dragging-changed", onDragChanged);
  }, [controls]);

  // Don't show if no model loaded
  if (bodyTransforms.length === 0) return null;

  // Compute model center in Three.js coords
  let sx = 0, sy = 0, sz = 0;
  for (const t of bodyTransforms) {
    const p = mjToThree(t.position as [number, number, number]);
    sx += p.x; sy += p.y; sz += p.z;
  }
  const n = bodyTransforms.length;
  const cx = sx / n + modelPosition[0];
  const cy = sy / n + modelPosition[1];
  const cz = sz / n + modelPosition[2];

  const handleChange = () => {
    if (!meshRef.current) return;
    const p = meshRef.current.position;
    // New model position = drag position - model center (without position offset)
    setModelPosition([
      p.x - sx / n,
      p.y - sy / n,
      p.z - sz / n,
    ]);
  };

  return (
    <>
      <mesh ref={meshRef} position={[cx, cy, cz]}>
        <sphereGeometry args={[0.005]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.3} />
      </mesh>
      {meshRef.current && (
        <TransformControls
          ref={controlsRef}
          object={meshRef.current}
          mode="translate"
          size={0.8}
          onObjectChange={handleChange}
        />
      )}
    </>
  );
}
