import React, { useRef, useEffect, useState } from "react";
import { TransformControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "../store";
import { mjToThree } from "../mujocoLoader";
import { markerRadius } from "../sceneScale";

export default function OffsetGizmo() {
  const selectedKp = useStore((s) => s.selectedKeypoint);
  const mappings = useStore((s) => s.mappings);
  const offsets = useStore((s) => s.offsets);
  const bodyTransforms = useStore((s) => s.bodyTransforms);
  const bodyNames = useStore((s) => s.bodyNames);
  const mode = useStore((s) => s.mode);
  const updateOffset = useStore((s) => s.updateOffset);
  const pushHistory = useStore((s) => s.pushHistory);
  const markerSizeMult = useStore((s) => s.markerSize);
  const handleR = markerRadius(bodyTransforms, markerSizeMult) * 0.6;
  // Hold the handle mesh in state (set via callback ref) rather than a plain
  // ref: a ref doesn't trigger a re-render, so on the first render after a
  // keypoint is selected `meshRef.current` is still null and TransformControls
  // would attach to nothing and sit at the world origin until some later
  // re-render. State forces a re-render the instant the mesh mounts, so the
  // gizmo attaches to the (already-positioned) handle straight away.
  const [handleMesh, setHandleMesh] = useState<THREE.Mesh | null>(null);
  const controlsRef = useRef<any>(null);
  const { controls } = useThree();

  // Disable orbit controls while dragging. Re-runs when `handleMesh` appears so
  // the listener binds to the TransformControls instance that only mounts once
  // the handle exists.
  useEffect(() => {
    const ctrl = controlsRef.current;
    if (!ctrl) return;
    const onDragChanged = (event: any) => {
      if (controls) (controls as any).enabled = !event.value;
      // Snapshot once at drag start so the whole drag is one undo step,
      // not one per pointermove tick.
      if (event.value) pushHistory();
    };
    ctrl.addEventListener("dragging-changed", onDragChanged);
    return () => ctrl.removeEventListener("dragging-changed", onDragChanged);
  }, [controls, pushHistory, handleMesh]);

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
    if (!handleMesh) return;
    const p = handleMesh.position;
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
      <mesh ref={setHandleMesh} position={[threePos.x, threePos.y, threePos.z]}>
        <sphereGeometry args={[handleR]} />
        <meshBasicMaterial color="#ffff00" transparent opacity={0.5} />
      </mesh>
      {handleMesh && (
        <TransformControls
          ref={controlsRef}
          object={handleMesh}
          mode="translate"
          size={0.5}
          onObjectChange={handleChange}
        />
      )}
    </>
  );
}
