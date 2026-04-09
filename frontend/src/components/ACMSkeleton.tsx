import React, { useMemo, useCallback, useRef } from "react";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import { useStore } from "../store";
import { mjToThree } from "../mujocoLoader";
import { segmentKey } from "../skeletonEditor";

const KP_COLORS: Record<string, string> = {
  // Rodent
  Snout: "#ffcc00", SpineF: "#ffaa00", SpineM: "#ff8800", SpineL: "#ff6600", TailBase: "#ee5500",
  ShoulderL: "#4488ff", ElbowL: "#3399ff", WristL: "#22aaff", HandL: "#11bbff",
  HipL: "#44aadd", KneeL: "#33bbcc", AnkleL: "#22ccbb", FootL: "#11ddaa",
  ShoulderR: "#ff4466", ElbowR: "#ff3377", WristR: "#ff2288", HandR: "#ff1199",
  HipR: "#ff6644", KneeR: "#ff5533", AnkleR: "#ff4422", FootR: "#ff3311",
  // Stick bug — body chain (warm gradient)
  mouth: "#ff3333", head: "#ff5533", head_t1: "#ff7733", t1_t2: "#ff9933",
  t2_t3: "#ffbb33", t3_a1: "#ffdd33", a2_a3: "#ddee33", a4_a5: "#bbee33",
  a6_a7: "#99ee33", a8_end: "#77ee33",
  // Stick bug — antennae
  r_antenna_base: "#ff88aa", r_antenna_tip: "#ff66aa",
  l_antenna_base: "#88aaff", l_antenna_tip: "#66aaff",
  // Stick bug — front legs
  f_l_coxa: "#4488ff", f_l_trochanter: "#3399ff", f_l_femur: "#22aaff",
  f_l_tibia: "#11bbff", f_l_tarsus: "#00ccff", f_l_claws: "#00ddff",
  f_r_coxa: "#ff4466", f_r_trochanter: "#ff3377", f_r_femur: "#ff2288",
  f_r_tibia: "#ff1199", f_r_tarsus: "#ff00aa", f_r_claws: "#ff00bb",
  // Stick bug — mid legs
  m_l_coxa: "#4488dd", m_l_trochanter: "#3399dd", m_l_femur: "#22aadd",
  m_l_tibia: "#11bbdd", m_l_tarsus: "#00ccdd", m_l_claws: "#00dddd",
  m_r_coxa: "#dd4466", m_r_trochanter: "#dd3377", m_r_femur: "#dd2288",
  m_r_tibia: "#dd1199", m_r_tarsus: "#dd00aa", m_r_claws: "#dd00bb",
  // Stick bug — hind legs
  h_l_coxa: "#4488bb", h_l_trochanter: "#3399bb", h_l_femur: "#22aabb",
  h_l_tibia: "#11bbbb", h_l_tarsus: "#00ccbb", h_l_claws: "#00ddbb",
  h_r_coxa: "#bb4466", h_r_trochanter: "#bb3377", h_r_femur: "#bb2288",
  h_r_tibia: "#bb1199", h_r_tarsus: "#bb00aa", h_r_claws: "#bb00bb",
};

// Adaptive sphere geometry cache — keyed by radius
const _sphereCache = new Map<number, THREE.SphereGeometry>();
function getSphereGeom(radius: number): THREE.SphereGeometry {
  // Round to 4 significant digits to allow cache hits
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

  // Compute adaptive sphere radius from median nearest-neighbor distance
  const sphereRadius = useMemo(() => {
    if (!positions || numKp === 0) return 0.003;
    // Use frame 0 keypoints to estimate typical inter-keypoint spacing
    const pts: [number, number, number][] = [];
    for (let i = 0; i < numKp; i++) {
      pts.push([
        positions[i * 3 + 0] * mocapScale,
        positions[i * 3 + 1] * mocapScale,
        positions[i * 3 + 2] * mocapScale,
      ]);
    }
    // Compute nearest-neighbor distances
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
    // Sphere radius = 20% of median nearest-neighbor distance
    return Math.max(median * 0.2, 0.0001);
  }, [positions, numKp, mocapScale]);

  const handleClick = useCallback(
    (name: string) => {
      if (mode === "mapping") setSelectedKp(name);
    },
    [mode, setSelectedKp]
  );

  if (!framePositions || framePositions.length === 0) return null;

  const nameToIdx: Record<string, number> = {};
  kpNames.forEach((n, i) => { nameToIdx[n] = i; });

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
        const color = isSelected ? "#ffff00" : isHighlighted ? "#ffffff" : KP_COLORS[name] || "#888888";
        const geom = getSphereGeom((isSelected || isHighlighted) ? sphereRadius * 1.6 : sphereRadius);
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
