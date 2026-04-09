import React, { useMemo, useCallback } from "react";
import * as THREE from "three";
import { useStore } from "../store";
import { mjToThree } from "../mujocoLoader";

// Adaptive sphere geometry cache
const _sphereCache = new Map<number, THREE.SphereGeometry>();
function getSphereGeom(radius: number): THREE.SphereGeometry {
  const key = Math.round(radius * 10000) / 10000;
  let geom = _sphereCache.get(key);
  if (!geom) {
    geom = new THREE.SphereGeometry(key, 12, 8);
    _sphereCache.set(key, geom);
  }
  return geom;
}

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
  const positions = useStore((s) => s.acmPositions);
  const numKp = useStore((s) => s.acmNumKeypoints);
  const mocapScale = useStore((s) => s.mocapScaleFactor);

  const isOffsetMode = mode === "offset";

  // Adaptive sphere radius from median nearest-neighbor distance
  const baseRadius = useMemo(() => {
    if (!positions || numKp === 0) return 0.003;
    const pts: [number, number, number][] = [];
    for (let i = 0; i < numKp; i++) {
      pts.push([
        positions[i * 3 + 0] * mocapScale,
        positions[i * 3 + 1] * mocapScale,
        positions[i * 3 + 2] * mocapScale,
      ]);
    }
    const nnDists: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      let minDist = Infinity;
      for (let j = 0; j < pts.length; j++) {
        if (i === j) continue;
        const d = Math.sqrt(
          (pts[i][0]-pts[j][0])**2 + (pts[i][1]-pts[j][1])**2 + (pts[i][2]-pts[j][2])**2
        );
        if (d > 1e-10 && d < minDist) minDist = d;
      }
      if (minDist < Infinity) nnDists.push(minDist);
    }
    if (nnDists.length === 0) return 0.003;
    nnDists.sort((a, b) => a - b);
    const median = nnDists[Math.floor(nnDists.length / 2)];
    return Math.max(median * 0.2, 0.0001);
  }, [positions, numKp, mocapScale]);

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
            geometry={getSphereGeom(m.isSelected ? baseRadius * 1.6 : baseRadius * 1.2)}
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
          geometry={getSphereGeom(baseRadius * 0.8)}
          material={getMaterial("#00cccc")}
        />
      ))}
    </group>
  );
}
