import { useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "../store";

// Reusable objects to avoid per-frame allocation
const _targetVec = new THREE.Vector3();

export default function FollowCamera() {
  const followCamera = useStore((s) => s.followCamera);
  const positions = useStore((s) => s.adjustedPositions ?? s.alignedPositions ?? s.acmPositions);
  const numKp = useStore((s) => s.acmNumKeypoints);
  const currentFrame = useStore((s) => s.currentFrame);
  const mocapScale = useStore((s) => s.mocapScaleFactor);
  const { camera, controls } = useThree();

  // Track which dataset we last auto-zoomed for
  const lastAutoZoomRef = useRef<string | null>(null);

  // Auto-zoom when a new dataset is loaded
  useEffect(() => {
    if (!positions || numKp === 0) return;
    const orbitControls = controls as any;
    if (!orbitControls?.target) return;

    // Create a fingerprint for the current dataset to avoid re-zooming
    const fingerprint = `${numKp}_${positions.length}_${mocapScale}`;
    if (lastAutoZoomRef.current === fingerprint) return;
    lastAutoZoomRef.current = fingerprint;

    // Compute bounding box of frame 0 keypoints (in Three.js coords)
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < numKp; i++) {
      const mx = positions[i * 3 + 0] * mocapScale;
      const my = positions[i * 3 + 1] * mocapScale;
      const mz = positions[i * 3 + 2] * mocapScale;
      // mjToThree: Three.js Y-up from MuJoCo Z-up → (x, z, -y)
      const tx = mx, ty = mz, tz = -my;
      minX = Math.min(minX, tx); maxX = Math.max(maxX, tx);
      minY = Math.min(minY, ty); maxY = Math.max(maxY, ty);
      minZ = Math.min(minZ, tz); maxZ = Math.max(maxZ, tz);
      cx += tx; cy += ty; cz += tz;
    }
    cx /= numKp; cy /= numKp; cz /= numKp;

    const diag = Math.sqrt((maxX-minX)**2 + (maxY-minY)**2 + (maxZ-minZ)**2);
    // Place camera at ~2.5x the bounding diagonal away, at 30° elevation
    const dist = Math.max(diag * 2.5, 0.05);

    const target = new THREE.Vector3(cx, cy, cz);
    orbitControls.target.copy(target);
    camera.position.set(cx + dist * 0.7, cy + dist * 0.4, cz + dist * 0.7);
    camera.lookAt(target);
    orbitControls.update();
  }, [positions, numKp, mocapScale, camera, controls]);

  // Per-frame follow
  useFrame(() => {
    if (!followCamera || !positions || numKp === 0) return;
    const orbitControls = controls as any;
    if (!orbitControls?.target) return;

    const offset = currentFrame * numKp * 3;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < numKp; i++) {
      const x = positions[offset + i * 3 + 0] * mocapScale;
      const y = positions[offset + i * 3 + 1] * mocapScale;
      const z = positions[offset + i * 3 + 2] * mocapScale;
      cx += x; cy += z; cz += -y;
    }
    cx /= numKp; cy /= numKp; cz /= numKp;

    _targetVec.set(cx, cy, cz);
    (orbitControls.target as THREE.Vector3).lerp(_targetVec, 0.1);
    orbitControls.update();
  });

  return null;
}
