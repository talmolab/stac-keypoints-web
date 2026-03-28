import React, { useMemo, useCallback } from "react";
import * as THREE from "three";
import { useStore } from "../store";
import { mjToThree } from "../mujocoLoader";
import { segmentKey } from "../skeletonEditor";

const KP_COLORS: Record<string, string> = {
  // Spine (orange/yellow)
  Snout: "#ffcc00", SpineF: "#ffaa00", SpineM: "#ff8800", SpineL: "#ff6600", TailBase: "#ee5500",
  // Left side (bright blue/cyan)
  ShoulderL: "#4488ff", ElbowL: "#3399ff", WristL: "#22aaff", HandL: "#11bbff",
  HipL: "#44aadd", KneeL: "#33bbcc", AnkleL: "#22ccbb", FootL: "#11ddaa",
  // Right side (bright red/pink)
  ShoulderR: "#ff4466", ElbowR: "#ff3377", WristR: "#ff2288", HandR: "#ff1199",
  HipR: "#ff6644", KneeR: "#ff5533", AnkleR: "#ff4422", FootR: "#ff3311",
};

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

  // Build set of keypoint names involved in hovered segment
  const highlightedKps = new Set<string>();
  if (hoveredSegment) {
    const parts = hoveredSegment.split("\u2192");
    if (parts.length === 2) {
      highlightedKps.add(parts[0].trim());
      highlightedKps.add(parts[1].trim());
    }
  }

  // Build bone lines — highlighted segment gets a different color
  const normalBonePoints: number[] = [];
  const highlightBonePoints: number[] = [];
  for (const bone of bones) {
    const pi = nameToIdx[bone.parent];
    const ci = nameToIdx[bone.child];
    if (pi === undefined || ci === undefined) continue;
    const p = framePositions[pi];
    const c = framePositions[ci];
    const key = segmentKey(bone.parent, bone.child);
    if (key === hoveredSegment) {
      highlightBonePoints.push(p.x, p.y, p.z, c.x, c.y, c.z);
    } else {
      normalBonePoints.push(p.x, p.y, p.z, c.x, c.y, c.z);
    }
  }

  return (
    <group>
      {kpNames.map((name, i) => {
        const pos = framePositions[i];
        const isSelected = selectedKp === name;
        const isHighlighted = highlightedKps.has(name);
        const color = isSelected ? "#ffff00" : isHighlighted ? "#ffffff" : KP_COLORS[name] || "#888888";
        const size = isSelected ? 0.005 : isHighlighted ? 0.005 : 0.003;
        return (
          <mesh
            key={name}
            position={pos}
            renderOrder={11}
            onClick={(e) => { e.stopPropagation(); handleClick(name); }}
            onPointerOver={(e) => { e.stopPropagation(); setHover(`KP: ${name}`, [pos.x, pos.y, pos.z]); }}
            onPointerOut={() => setHover(null)}
          >
            <sphereGeometry args={[size, 12, 8]} />
            <meshBasicMaterial color={color} depthTest={false} />
          </mesh>
        );
      })}
      {/* Normal bone lines */}
      {normalBonePoints.length > 0 && (
        <lineSegments renderOrder={10}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[new Float32Array(normalBonePoints), 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#999999" depthTest={false} />
        </lineSegments>
      )}
      {/* Highlighted bone line */}
      {highlightBonePoints.length > 0 && (
        <lineSegments renderOrder={12}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[new Float32Array(highlightBonePoints), 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#ffffff" depthTest={false} />
        </lineSegments>
      )}
    </group>
  );
}
