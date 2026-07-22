import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildGeomGeometry } from "../mujocoLoader";
import type { GeomData } from "../types";

function meshGeom(vertices: number[], faces: number[]): GeomData {
  return {
    type: "mesh",
    bodyId: 1,
    bodyName: "b",
    size: [1, 1, 1],
    position: [0, 0, 0],
    quaternion: [1, 0, 0, 0],
    color: [0.5, 0.5, 0.5, 1],
    vertices,
    faces,
  };
}

describe("buildGeomGeometry — mesh", () => {
  it("builds an indexed BufferGeometry from real triangle data", () => {
    // A unit tetrahedron: 4 verts, 4 triangular faces.
    const verts = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
    const faces = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];
    const g = buildGeomGeometry(meshGeom(verts, faces))!;
    expect(g).toBeInstanceOf(THREE.BufferGeometry);
    const pos = g.getAttribute("position");
    expect(pos.count).toBe(4);
    expect(g.getIndex()!.count).toBe(faces.length);
    // Normals are computed so the surface actually shades.
    expect(g.getAttribute("normal")).toBeTruthy();
  });

  it("swizzles MuJoCo (Z-up) vertices to Three.js (Y-up): (x,y,z)→(x,z,-y)", () => {
    // Single triangle with one distinctive vertex to check the axis map.
    const verts = [1, 2, 3, 0, 0, 0, 0, 0, 0];
    const faces = [0, 1, 2];
    const g = buildGeomGeometry(meshGeom(verts, faces))!;
    const pos = g.getAttribute("position");
    expect([pos.getX(0), pos.getY(0), pos.getZ(0)]).toEqual([1, 3, -2]);
  });

  it("returns null when a mesh geom carries no triangle data", () => {
    expect(buildGeomGeometry(meshGeom([], []))).toBeNull();
    expect(buildGeomGeometry({ ...meshGeom([1, 2, 3], []), faces: undefined })).toBeNull();
    expect(buildGeomGeometry({ ...meshGeom([], [0, 1, 2]), vertices: undefined })).toBeNull();
  });

  it("still builds primitives (regression guard)", () => {
    const sphere: GeomData = {
      type: "sphere", bodyId: 0, bodyName: "b", size: [0.1, 0, 0],
      position: [0, 0, 0], quaternion: [1, 0, 0, 0], color: [1, 1, 1, 1],
    };
    expect(buildGeomGeometry(sphere)).toBeInstanceOf(THREE.SphereGeometry);
  });
});
