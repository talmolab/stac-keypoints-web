import React, { useMemo, useCallback, useRef } from "react";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import { useStore } from "../store";
import { mjToThree } from "../mujocoLoader";
import { segmentKey } from "../skeletonEditor";
import { errorToColor } from "../errorColor";

const KP_COLORS: Record<string, string> = {
  Snout: "#ffcc00", SpineF: "#ffaa00", SpineM: "#ff8800", SpineL: "#ff6600", TailBase: "#ee5500",
  ShoulderL: "#4488ff", ElbowL: "#3399ff", WristL: "#22aaff", HandL: "#11bbff",
  HipL: "#44aadd", KneeL: "#33bbcc", AnkleL: "#22ccbb", FootL: "#11ddaa",
  ShoulderR: "#ff4466", ElbowR: "#ff3377", WristR: "#ff2288", HandR: "#ff1199",
  HipR: "#ff6644", KneeR: "#ff5533", AnkleR: "#ff4422", FootR: "#ff3311",
};

// Shared geometries — created once, reused across renders
const _smallSphere = new THREE.SphereGeometry(0.003, 12, 8);
const _largeSphere = new THREE.SphereGeometry(0.005, 12, 8);

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

export default function ACMSkeleton() {
  const kpNames = useStore((s) => s.acmKeypointNames);
  const bones = useStore((s) => s.acmBones);
  const positions = useStore((s) => s.adjustedPositions ?? s.alignedPositions ?? s.acmPositions);
  const numKp = useStore((s) => s.acmNumKeypoints);
  const currentFrame = useStore((s) => s.currentFrame);
  const mocapScale = useStore((s) => s.mocapScaleFactor);
  const mode = useStore((s) => s.mode);
  const selectedKp = useStore((s) => s.selectedKeypoint);
  const setSelectedKp = useStore((s) => s.setSelectedKeypoint);
  const setHover = useStore((s) => s.setHover);
  const hoveredSegment = useStore((s) => s.hoveredSegment);
  const colorByError = useStore((s) => s.colorByError);
  const perKeypointErrors = useStore((s) => s.perKeypointErrors);

  // Cache mesh refs for imperative position updates (avoids re-render)
  const meshRefs = useRef<Map<string, THREE.Mesh>>(new Map());

  const framePositions = useMemo(() => {
    if (!positions || numKp === 0) return null;
    const offset = currentFrame * numKp * 3;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < numKp; i++) {
      const x = positions[offset + i * 3 + 0] * mocapScale;
      const y = positions[offset + i * 3 + 1] * mocapScale;
      const z = positions[offset + i * 3 + 2] * mocapScale;
      pts.push(mjToThree([x, y, z]));
    }
    return pts;
  }, [positions, currentFrame, numKp, mocapScale]);

  const handleClick = useCallback(
    (name: string) => {
      if (mode === "mapping") setSelectedKp(name);
    },
    [mode, setSelectedKp]
  );

  if (!framePositions || framePositions.length === 0) return null;

  const nameToIdx: Record<string, number> = {};
  kpNames.forEach((n, i) => { nameToIdx[n] = i; });

  // Lookup table for per-keypoint error so render is O(1) per marker.
  const errorByName: Record<string, number> = {};
  if (colorByError) {
    for (const e of perKeypointErrors) errorByName[e.keypointName] = e.errorMm;
  }

  const highlightedKps = new Set<string>();
  if (hoveredSegment) {
    const parts = hoveredSegment.split("\u2192");
    if (parts.length === 2) {
      highlightedKps.add(parts[0].trim());
      highlightedKps.add(parts[1].trim());
    }
  }

  const boneData = bones.map((bone) => {
    const pi = nameToIdx[bone.parent];
    const ci = nameToIdx[bone.child];
    if (pi === undefined || ci === undefined) return null;
    const p = framePositions[pi];
    const c = framePositions[ci];
    const key = segmentKey(bone.parent, bone.child);
    const isHl = key === hoveredSegment;
    return { points: [[p.x, p.y, p.z], [c.x, c.y, c.z]] as [number, number, number][], color: isHl ? "#ffffff" : "#999999", lineWidth: isHl ? 3 : 1.5 };
  }).filter(Boolean) as { points: [number, number, number][]; color: string; lineWidth: number }[];

  return (
    <group>
      {kpNames.map((name, i) => {
        const pos = framePositions[i];
        const isSelected = selectedKp === name;
        const isHighlighted = highlightedKps.has(name);
        const errorMm = errorByName[name];
        const errorColor = errorMm !== undefined ? errorToColor(errorMm) : null;
        const color = isSelected
          ? "#ffff00"
          : isHighlighted
          ? "#ffffff"
          : errorColor ?? KP_COLORS[name] ?? "#888888";
        const geom = (isSelected || isHighlighted) ? _largeSphere : _smallSphere;
        return (
          <mesh
            key={name}
            ref={(ref: THREE.Mesh | null) => { if (ref) meshRefs.current.set(name, ref); }}
            position={pos}
            geometry={geom}
            material={getMaterial(color)}
            renderOrder={11}
            onClick={(e) => { e.stopPropagation(); handleClick(name); }}
            onPointerOver={(e) => { e.stopPropagation(); setHover(`KP: ${name}`, [pos.x, pos.y, pos.z]); }}
            onPointerOut={() => setHover(null)}
          />
        );
      })}
      {boneData.map((b, i) => (
        <Line
          key={i}
          points={b.points}
          color={b.color}
          lineWidth={b.lineWidth}
          depthTest={false}
          renderOrder={10}
        />
      ))}
    </group>
  );
}
