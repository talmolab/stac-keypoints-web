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
    case "mesh": {
      // Real triangle mesh. `vertices` is a flat [x,y,z,...] array in the
      // geom-local MuJoCo (Z-up) frame; swizzle each vertex to Three.js
      // (Y-up): (x,y,z) → (x,z,-y), the same map mjToThree applies to the
      // geom's local position. That swizzle is a proper rotation (det +1) so
      // triangle winding is preserved — no need to flip face indices.
      const v = geom.vertices;
      const f = geom.faces;
      if (!v || !f || v.length < 9 || f.length < 3) return null;
      const g = new THREE.BufferGeometry();
      const n = v.length / 3;
      const pos = new Float32Array(v.length);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = v[i * 3];          // x
        pos[i * 3 + 1] = v[i * 3 + 2];  // z → Three y
        pos[i * 3 + 2] = -v[i * 3 + 1]; // -y → Three z
      }
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setIndex(f);
      g.computeVertexNormals();
      return g;
    }
    default:
      return null;
  }
}
