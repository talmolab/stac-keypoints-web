import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "../store";

// Frame the camera to the model whenever a new model loads. FollowCamera only
// moves the orbit target from keypoints and never sets distance, so a species
// with no keypoint clip (every preset except rat) was never reframed — the
// camera stayed anchored on the previous model and the new one landed
// off-screen. This fits once per model: it keys on the model's body transforms
// (which change on load) and a remembered xmlPath, so it doesn't fight
// FollowCamera or re-fire on every IK/scrub update.
export default function FitCameraOnLoad() {
  const { camera, controls } = useThree();
  const bodyTransforms = useStore((s) => s.bodyTransforms);
  const lastFit = useRef<string | null>(null);

  useEffect(() => {
    const orbit = controls as unknown as { target?: THREE.Vector3; update?: () => void };
    if (!orbit?.target || !Array.isArray(bodyTransforms) || bodyTransforms.length === 0) return;
    // Read xmlPath imperatively so this effect fires on the body-transforms
    // update (which carries the NEW model's pose), not on the earlier xmlPath
    // change (which still has the OLD pose in the store).
    const xmlPath = useStore.getState().xmlPath;
    if (!xmlPath || xmlPath === lastFit.current) return;

    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const p = new THREE.Vector3();
    for (const t of bodyTransforms) {
      // mjToThree: (x, y, z) → (x, z, -y). Model transform is reset to identity
      // on load, so body world positions match the rendered scene.
      p.set(t.position[0], t.position[2], -t.position[1]);
      min.min(p);
      max.max(p);
    }
    if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) return;

    const center = min.clone().add(max).multiplyScalar(0.5);
    const size = Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 1e-4);
    const dist = size * 2.7; // body origins underestimate extent; pad generously

    orbit.target.copy(center);
    // Consistent 3/4 view, scaled to the model.
    const dir = new THREE.Vector3(1, 0.6, 1).normalize();
    camera.position.copy(center).addScaledVector(dir, dist);
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const cam = camera as THREE.PerspectiveCamera;
      cam.near = Math.max(size / 100, 1e-4);
      cam.far = size * 100 + 100;
      cam.updateProjectionMatrix();
    }
    orbit.update?.();
    lastFit.current = xmlPath;
  }, [bodyTransforms, camera, controls]);

  return null;
}
