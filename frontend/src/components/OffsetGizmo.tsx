import React, { useRef, useEffect } from "react";
import { TransformControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "../store";
import { mjToThree } from "../mujocoLoader";

export default function OffsetGizmo() {
  const selectedKp = useStore((s) => s.selectedKeypoint);
  const mappings = useStore((s) => s.mappings);
  const offsets = useStore((s) => s.offsets);
  const bodyTransforms = useStore((s) => s.bodyTransforms);
  const bodyNames = useStore((s) => s.bodyNames);
  const mode = useStore((s) => s.mode);
  const updateOffset = useStore((s) => s.updateOffset);
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

  if (mode !== "offset" || !selectedKp) return null;

  const mapping = mappings.find((m) => m.keypointName === selectedKp);
  if (!mapping) return null;

  const bodyIdx = bodyNames.indexOf(mapping.bodyName);
  if (bodyIdx < 0 || !bodyTransforms[bodyIdx]) return null;
  const bt = bodyTransforms[bodyIdx];

  const currentOffset = offsets.find((o) => o.keypointName === selectedKp) || {
    x: 0,
    y: 0,
    z: 0,
  };

  // Body origin + offset in MuJoCo coords
  const worldMj: [number, number, number] = [
    bt.position[0] + currentOffset.x,
    bt.position[1] + currentOffset.y,
    bt.position[2] + currentOffset.z,
  ];
  const threePos = mjToThree(worldMj);

  const handleChange = () => {
    if (!meshRef.current) return;
    const p = meshRef.current.position;
    // Three.js (x, y, z) -> MuJoCo (x, -z, y)
    const newMjWorld = [p.x, -p.z, p.y];
    updateOffset(
      selectedKp!,
      newMjWorld[0] - bt.position[0],
      newMjWorld[1] - bt.position[1],
      newMjWorld[2] - bt.position[2]
    );
  };

  return (
    <>
      <mesh ref={meshRef} position={[threePos.x, threePos.y, threePos.z]}>
        <sphereGeometry args={[0.002]} />
        <meshBasicMaterial color="#ffff00" transparent opacity={0.5} />
      </mesh>
      <TransformControls
        ref={controlsRef}
        object={meshRef.current || undefined}
        mode="translate"
        size={0.5}
        onObjectChange={handleChange}
      />
    </>
  );
}
