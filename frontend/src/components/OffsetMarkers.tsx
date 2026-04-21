import React, { useMemo, useCallback } from "react";
import * as THREE from "three";
import { useStore } from "../store";
import { mjToThree } from "../mujocoLoader";

// Shared geometries — created once, reused across renders
const _passiveSphere = new THREE.SphereGeometry(0.0025, 10, 6);
const _offsetSphere = new THREE.SphereGeometry(0.004, 12, 8);
const _offsetSphereSelected = new THREE.SphereGeometry(0.005, 12, 8);

// Shared material cache (by color string)
const _materialCache = new Map<string, THREE.MeshBasicMaterial>();
function getMaterial(color: string): THREE.MeshBasicMaterial {
  let mat = _materialCache.get(color);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
    _materialCache.set(color, mat);
  }
  return mat;
}

export default function OffsetMarkers() {
  const mappings = useStore((s) => s.mappings);
  const offsets = useStore((s) => s.offsets);
  const bodyTransforms = useStore((s) => s.bodyTransforms);
  const bodyNames = useStore((s) => s.bodyNames);
  const mode = useStore((s) => s.mode);
  const showOffsetMarkers = useStore((s) => s.showOffsetMarkers);
  const selectedKp = useStore((s) => s.selectedKeypoint);
  const setSelectedKp = useStore((s) => s.setSelectedKeypoint);
  const setHover = useStore((s) => s.setHover);

  const isOffsetMode = mode === "offset";

  const markers = useMemo(() => {
    if (!isOffsetMode && !showOffsetMarkers) return [];
    if (bodyTransforms.length === 0) return [];
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
        bodyName: m.bodyName,
        position: mjToThree(worldPos),
        isSelected: selectedKp === m.keypointName,
      };
    }).filter(Boolean) as { keypointName: string; bodyName: string; position: THREE.Vector3; isSelected: boolean }[];
  }, [mappings, offsets, bodyTransforms, bodyNames, isOffsetMode, showOffsetMarkers, selectedKp]);

  const handleClick = useCallback(
    (e: any, name: string) => { e.stopPropagation(); if (isOffsetMode) setSelectedKp(name); },
    [isOffsetMode, setSelectedKp]
  );

  if (markers.length === 0) return null;

  // Offset mode: green interactive markers (clickable, hoverable)
  if (isOffsetMode) {
    return (
      <group renderOrder={10}>
        {markers.map((m) => (
          <mesh
            key={m.keypointName}
            position={m.position}
            onClick={(e) => handleClick(e, m.keypointName)}
            onPointerOver={(e) => { e.stopPropagation(); setHover(`Offset: ${m.keypointName} → ${m.bodyName}`, [m.position.x, m.position.y, m.position.z]); }}
            onPointerOut={() => setHover(null)}
            renderOrder={10}
            geometry={m.isSelected ? _offsetSphereSelected : _offsetSphere}
            material={getMaterial(m.isSelected ? "#00ff88" : "#00cc66")}
          />
        ))}
      </group>
    );
  }

  // Other modes with toggle on: smaller cyan passive markers (non-interactive)
  return (
    <group renderOrder={10}>
      {markers.map((m) => (
        <mesh
          key={m.keypointName}
          position={m.position}
          renderOrder={10}
          geometry={_passiveSphere}
          material={getMaterial("#00cccc")}
        />
      ))}
    </group>
  );
}
