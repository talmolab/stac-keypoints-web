import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "../store";
import { mjToThree } from "../mujocoLoader";

export default function FollowCamera() {
  const followCamera = useStore((s) => s.followCamera);
  const positions = useStore((s) => s.adjustedPositions ?? s.alignedPositions ?? s.acmPositions);
  const numKp = useStore((s) => s.acmNumKeypoints);
  const currentFrame = useStore((s) => s.currentFrame);
  const mocapScale = useStore((s) => s.mocapScaleFactor);
  const kpNames = useStore((s) => s.acmKeypointNames);
  const { controls } = useThree();

  useFrame(() => {
    if (!followCamera || !positions || numKp === 0) return;
    const orbitControls = controls as any;
    if (!orbitControls?.target) return;

    // Compute center of spine keypoints for current frame
    const spineKps = ["SpineL", "SpineM", "SpineF"];
    const nameToIdx: Record<string, number> = {};
    kpNames.forEach((n, i) => { nameToIdx[n] = i; });

    const offset = currentFrame * numKp * 3;
    let cx = 0, cy = 0, cz = 0, count = 0;
    for (const name of spineKps) {
      const idx = nameToIdx[name];
      if (idx === undefined) continue;
      const x = positions[offset + idx * 3 + 0] * mocapScale;
      const y = positions[offset + idx * 3 + 1] * mocapScale;
      const z = positions[offset + idx * 3 + 2] * mocapScale;
      const p = mjToThree([x, y, z]);
      cx += p.x; cy += p.y; cz += p.z;
      count++;
    }
    if (count === 0) return;
    cx /= count; cy /= count; cz /= count;

    // Smoothly interpolate target to spine center
    const target = orbitControls.target as THREE.Vector3;
    target.lerp(new THREE.Vector3(cx, cy, cz), 0.1);
    orbitControls.update();
  });

  return null;
}
