import React, { useMemo, useCallback } from "react";
import * as THREE from "three";
import { useStore } from "../store";
import { mjToThree } from "../mujocoLoader";

export default function OffsetMarkers() {
  const mappings = useStore((s) => s.mappings);
  const offsets = useStore((s) => s.offsets);
  const bodyTransforms = useStore((s) => s.bodyTransforms);
  const bodyNames = useStore((s) => s.bodyNames);
  const mode = useStore((s) => s.mode);
  const selectedKp = useStore((s) => s.selectedKeypoint);
  const setSelectedKp = useStore((s) => s.setSelectedKeypoint);

  const markers = useMemo(() => {
    if (mode !== "offset" || bodyTransforms.length === 0) return [];
    const nameToBodyIdx = Object.fromEntries(bodyNames.map((n, i) => [n, i]));
    const offsetMap = Object.fromEntries(offsets.map((o) => [o.keypointName, o]));
    return mappings.map((m) => {
      const bodyIdx = nameToBodyIdx[m.bodyName];
      if (bodyIdx === undefined) return null;
      const bt = bodyTransforms[bodyIdx];
      if (!bt) return null;
      const offset = offsetMap[m.keypointName] || { x: 0, y: 0, z: 0 };
      const worldPos: [number, number, number] = [
        bt.position[0] + offset.x, bt.position[1] + offset.y, bt.position[2] + offset.z,
      ];
      return {
        keypointName: m.keypointName,
        position: mjToThree(worldPos),
        isSelected: selectedKp === m.keypointName,
      };
    }).filter(Boolean) as { keypointName: string; position: THREE.Vector3; isSelected: boolean }[];
  }, [mappings, offsets, bodyTransforms, bodyNames, mode, selectedKp]);

  const handleClick = useCallback(
    (e: any, name: string) => { e.stopPropagation(); if (mode === "offset") setSelectedKp(name); },
    [mode, setSelectedKp]
  );

  return (
    <group>
      {markers.map((m) => (
        <mesh key={m.keypointName} position={m.position} onClick={(e) => handleClick(e, m.keypointName)}>
          <sphereGeometry args={[m.isSelected ? 0.004 : 0.003, 12, 8]} />
          <meshBasicMaterial color={m.isSelected ? "#ffff00" : "#00ff88"} />
        </mesh>
      ))}
    </group>
  );
}
