import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

const MOVE_SPEED = 0.003;
const ROTATE_SPEED = 0.02;
const FAST_MULT = 2.5;

const keysPressed = new Set<string>();

// Track keys globally
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    keysPressed.add(e.code);
  });
  window.addEventListener("keyup", (e) => keysPressed.delete(e.code));
  window.addEventListener("blur", () => keysPressed.clear());
}

export function CameraKeyboardControls() {
  const { camera, controls } = useThree();

  useFrame(() => {
    if (keysPressed.size === 0) return;
    const orbitControls = controls as any;
    if (!orbitControls?.target) return;

    const speed = keysPressed.has("ShiftLeft") || keysPressed.has("ShiftRight")
      ? MOVE_SPEED * FAST_MULT : MOVE_SPEED;

    // Forward/backward (W/S) -- move along camera look direction
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0; // keep horizontal
    forward.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(forward, camera.up).normalize();

    if (keysPressed.has("KeyW")) {
      camera.position.addScaledVector(forward, speed);
      orbitControls.target.addScaledVector(forward, speed);
    }
    if (keysPressed.has("KeyS")) {
      camera.position.addScaledVector(forward, -speed);
      orbitControls.target.addScaledVector(forward, -speed);
    }
    if (keysPressed.has("KeyA")) {
      camera.position.addScaledVector(right, -speed);
      orbitControls.target.addScaledVector(right, -speed);
    }
    if (keysPressed.has("KeyD")) {
      camera.position.addScaledVector(right, speed);
      orbitControls.target.addScaledVector(right, speed);
    }
    if (keysPressed.has("KeyR")) {
      camera.position.y += speed;
      orbitControls.target.y += speed;
    }
    if (keysPressed.has("KeyF")) {
      camera.position.y -= speed;
      orbitControls.target.y -= speed;
    }

    // Orbit rotation (Q/E) -- rotate around target
    if (keysPressed.has("KeyQ") || keysPressed.has("KeyE")) {
      const angle = keysPressed.has("KeyQ") ? ROTATE_SPEED : -ROTATE_SPEED;
      const offset = camera.position.clone().sub(orbitControls.target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      camera.position.copy(orbitControls.target).add(offset);
      camera.lookAt(orbitControls.target);
    }

    orbitControls.update();
  });

  return null;
}
