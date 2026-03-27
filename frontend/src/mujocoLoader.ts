import * as THREE from "three";
import type { GeomData } from "./types";

/** Convert MuJoCo (Z-up) to Three.js (Y-up): (x,y,z) → (x,z,-y) */
export function mjToThree(pos: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(pos[0], pos[2], -pos[1]);
}

/** Convert MuJoCo quaternion (w,x,y,z) to Three.js with axis swizzle */
export function mjQuatToThree(q: [number, number, number, number]): THREE.Quaternion {
  return new THREE.Quaternion(q[1], q[3], -q[2], q[0]);
}

/** Build Three.js geometry for a MuJoCo geom type */
export function buildGeomGeometry(geom: GeomData): THREE.BufferGeometry | null {
  switch (geom.type) {
    case "sphere":
      return new THREE.SphereGeometry(geom.size[0], 16, 12);
    case "capsule":
      return new THREE.CapsuleGeometry(geom.size[0], geom.size[1] * 2.0, 8, 16);
    case "cylinder":
      return new THREE.CylinderGeometry(geom.size[0], geom.size[0], geom.size[1] * 2.0, 16);
    case "box":
      return new THREE.BoxGeometry(geom.size[0] * 2, geom.size[2] * 2, geom.size[1] * 2);
    case "ellipsoid": {
      const g = new THREE.SphereGeometry(1, 16, 12);
      g.scale(geom.size[0], geom.size[2], geom.size[1]);
      return g;
    }
    default:
      return null;
  }
}
