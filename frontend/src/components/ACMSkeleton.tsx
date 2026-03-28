import React, { useMemo, useCallback } from "react";
import * as THREE from "three";
import { useStore } from "../store";
import { mjToThree } from "../mujocoLoader";

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
  const positions = useStore((s) => s.alignedPositions ?? s.acmPositions);
  const numKp = useStore((s) => s.acmNumKeypoints);
  const currentFrame = useStore((s) => s.currentFrame);
  const mocapScale = useStore((s) => s.mocapScaleFactor);
  const mode = useStore((s) => s.mode);
  const selectedKp = useStore((s) => s.selectedKeypoint);
  const setSelectedKp = useStore((s) => s.setSelectedKeypoint);

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

  const bonePoints: number[] = [];
  for (const bone of bones) {
    const pi = nameToIdx[bone.parent];
    const ci = nameToIdx[bone.child];
    if (pi !== undefined && ci !== undefined) {
      const p = framePositions[pi];
      const c = framePositions[ci];
      bonePoints.push(p.x, p.y, p.z, c.x, c.y, c.z);
    }
  }

  return (
    <group>
      {kpNames.map((name, i) => {
        const pos = framePositions[i];
        const isSelected = selectedKp === name;
        const color = isSelected ? "#ffff00" : KP_COLORS[name] || "#888888";
        const size = isSelected ? 0.005 : 0.003;
        return (
          <mesh key={name} position={pos} onClick={(e) => { e.stopPropagation(); handleClick(name); }}>
            <sphereGeometry args={[size, 12, 8]} />
            <meshBasicMaterial color={color} />
          </mesh>
        );
      })}
      {bonePoints.length > 0 && (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[new Float32Array(bonePoints), 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#999999" />
        </lineSegments>
      )}
    </group>
  );
}
