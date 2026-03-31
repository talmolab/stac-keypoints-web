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

// Reusable vectors — avoids allocating new Vector3 every frame
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);

export function CameraKeyboardControls() {
  const { camera, controls } = useThree();

  useFrame(() => {
    if (keysPressed.size === 0) return;
    const orbitControls = controls as any;
    if (!orbitControls?.target) return;

    const speed = keysPressed.has("ShiftLeft") || keysPressed.has("ShiftRight")
      ? MOVE_SPEED * FAST_MULT : MOVE_SPEED;

    camera.getWorldDirection(_forward);
    _forward.y = 0;
    _forward.normalize();

    _right.crossVectors(_forward, camera.up).normalize();

    if (keysPressed.has("KeyW")) {
      camera.position.addScaledVector(_forward, speed);
      orbitControls.target.addScaledVector(_forward, speed);
    }
    if (keysPressed.has("KeyS")) {
      camera.position.addScaledVector(_forward, -speed);
      orbitControls.target.addScaledVector(_forward, -speed);
    }
    if (keysPressed.has("KeyA")) {
      camera.position.addScaledVector(_right, -speed);
      orbitControls.target.addScaledVector(_right, -speed);
    }
    if (keysPressed.has("KeyD")) {
      camera.position.addScaledVector(_right, speed);
      orbitControls.target.addScaledVector(_right, speed);
    }
    if (keysPressed.has("KeyR")) {
      camera.position.y += speed;
      orbitControls.target.y += speed;
    }
    if (keysPressed.has("KeyF")) {
      camera.position.y -= speed;
      orbitControls.target.y -= speed;
    }

    // Orbit rotation (Q/E)
    if (keysPressed.has("KeyQ") || keysPressed.has("KeyE")) {
      const angle = keysPressed.has("KeyE") ? ROTATE_SPEED : -ROTATE_SPEED;
      _offset.copy(camera.position).sub(orbitControls.target);
      _offset.applyAxisAngle(_yAxis, angle);
      camera.position.copy(orbitControls.target).add(_offset);
      camera.lookAt(orbitControls.target);
    }

    orbitControls.update();
  });

  return null;
}
