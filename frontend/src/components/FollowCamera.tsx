import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "../store";
import { mjToThree } from "../mujocoLoader";

// Reusable objects to avoid per-frame allocation
const _targetVec = new THREE.Vector3();
const _tempVec = new THREE.Vector3();

export default function FollowCamera() {
  const followCamera = useStore((s) => s.followCamera);
  const positions = useStore((s) => s.adjustedPositions ?? s.alignedPositions ?? s.acmPositions);
  const numKp = useStore((s) => s.acmNumKeypoints);
  const currentFrame = useStore((s) => s.currentFrame);
  const mocapScale = useStore((s) => s.mocapScaleFactor);
  const kpNames = useStore((s) => s.acmKeypointNames);
  const { controls } = useThree();

  // Cache name→idx mapping
  const nameToIdxRef = useRef<Record<string, number>>({});
  if (kpNames.length > 0 && Object.keys(nameToIdxRef.current).length !== kpNames.length) {
    const map: Record<string, number> = {};
    kpNames.forEach((n, i) => { map[n] = i; });
    nameToIdxRef.current = map;
  }

  useFrame(() => {
    if (!followCamera || !positions || numKp === 0) return;
    const orbitControls = controls as any;
    if (!orbitControls?.target) return;

    const nameToIdx = nameToIdxRef.current;
    const spineKps = ["SpineL", "SpineM", "SpineF"];
    const offset = currentFrame * numKp * 3;
    let cx = 0, cy = 0, cz = 0, count = 0;
    for (const name of spineKps) {
      const idx = nameToIdx[name];
      if (idx === undefined) continue;
      const x = positions[offset + idx * 3 + 0] * mocapScale;
      const y = positions[offset + idx * 3 + 1] * mocapScale;
      const z = positions[offset + idx * 3 + 2] * mocapScale;
      // Inline mjToThree to avoid creating Vector3
      cx += x; cy += z; cz += -y;
      count++;
    }
    if (count === 0) return;
    cx /= count; cy /= count; cz /= count;

    // Lerp using reusable vector (no allocation)
    _targetVec.set(cx, cy, cz);
    (orbitControls.target as THREE.Vector3).lerp(_targetVec, 0.1);
    orbitControls.update();
  });

  return null;
}
