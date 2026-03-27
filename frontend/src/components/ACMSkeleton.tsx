import React, { useMemo, useCallback } from "react";
import * as THREE from "three";
import { useStore } from "../store";
import { mjToThree } from "../mujocoLoader";

const KP_COLORS: Record<string, string> = {
  Snout: "#ff8800", SpineF: "#ff6600", SpineM: "#ff4400", SpineL: "#ff2200", TailBase: "#cc4400",
  ShoulderL: "#0066ff", ElbowL: "#0055dd", WristL: "#0044bb", HandL: "#003399",
  ShoulderR: "#ff0044", ElbowR: "#dd0033", WristR: "#bb0022", HandR: "#990011",
  HipL: "#003366", KneeL: "#002255", AnkleL: "#001144", FootL: "#001133",
  HipR: "#660011", KneeR: "#550011", AnkleR: "#440011", FootR: "#330011",
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
          <lineBasicMaterial color="#666666" />
        </lineSegments>
      )}
    </group>
  );
}
