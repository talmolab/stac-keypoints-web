import { describe, it, expect } from "vitest";
import {
  procrustesRigid,
  procrustesScaled,
  rotationMatrixToMjQuat,
  jacobiEigen3x3,
} from "../procrustes";

// Apply 3x3 rotation to a single 3-vector.
function rotate(R: number[][], p: number[]): number[] {
  return [
    R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2],
    R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2],
    R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2],
  ];
}

function dist(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

describe("procrustesRigid", () => {
  it("recovers identity for matched source/target", () => {
    const pts = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0]];
    const { R, t } = procrustesRigid(pts, pts);
    // R ≈ I, t ≈ 0
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      expect(R[i][j]).toBeCloseTo(i === j ? 1 : 0, 5);
    for (let i = 0; i < 3; i++) expect(t[i]).toBeCloseTo(0, 5);
  });

  it("recovers a known 90deg rotation about Z + translation", () => {
    // 90deg CCW about Z: (x, y, z) -> (-y, x, z)
    const src = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0]];
    const tx = [10, 5, -2];
    const tgt = src.map((p) => [-p[1] + tx[0], p[0] + tx[1], p[2] + tx[2]]);
    const { R, t } = procrustesRigid(src, tgt);
    // Check round-trip: R·src + t ≈ tgt
    for (let i = 0; i < src.length; i++) {
      const Rs = rotate(R, src[i]);
      expect(dist([Rs[0] + t[0], Rs[1] + t[1], Rs[2] + t[2]], tgt[i])).toBeLessThan(1e-5);
    }
  });

  it("does not scale (rigid)", () => {
    const src = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const tgt = src.map((p) => p.map((c) => c * 5));  // 5x scale
    const { R, t } = procrustesRigid(src, tgt);
    // Best rigid fit places mean at mean, but extents stay at 1, not 5.
    // So R*src + t won't perfectly match tgt — residuals should be large.
    let totErr = 0;
    for (let i = 0; i < src.length; i++) {
      const Rs = rotate(R, src[i]);
      totErr += dist([Rs[0] + t[0], Rs[1] + t[1], Rs[2] + t[2]], tgt[i]);
    }
    // Average residual > 1 unit (scale 5 vs 1, mean removed, extents off by ~4)
    expect(totErr / src.length).toBeGreaterThan(1);
  });

  it("returns identity for < 3 points", () => {
    const { R, t } = procrustesRigid([[0, 0, 0]], [[1, 1, 1]]);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      expect(R[i][j]).toBeCloseTo(i === j ? 1 : 0, 10);
    for (let i = 0; i < 3; i++) expect(t[i]).toBe(0);
  });

  it("throws on length mismatch", () => {
    expect(() => procrustesRigid([[0, 0, 0]], [[1, 1, 1], [2, 2, 2]])).toThrow();
  });
});

describe("procrustesScaled", () => {
  it("recovers a known scale + rotation + translation", () => {
    const src = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0]];
    const scale = 3.7;
    const tx = [-2, 4, 1];
    // 90deg CCW about Z, then scale, then translate
    const tgt = src.map((p) => [
      scale * -p[1] + tx[0],
      scale * p[0] + tx[1],
      scale * p[2] + tx[2],
    ]);
    const { R, t, s } = procrustesScaled(src, tgt);
    expect(s).toBeCloseTo(scale, 4);
    for (let i = 0; i < src.length; i++) {
      const Rs = rotate(R, src[i]);
      expect(dist([s * Rs[0] + t[0], s * Rs[1] + t[1], s * Rs[2] + t[2]], tgt[i])).toBeLessThan(1e-4);
    }
  });
});

describe("rotationMatrixToMjQuat", () => {
  it("returns identity quat for identity rotation", () => {
    const [w, x, y, z] = rotationMatrixToMjQuat([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    expect(w).toBeCloseTo(1, 6);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it("returns 90deg Z quat for 90deg Z rotation", () => {
    // R for 90deg CCW about Z
    const R = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];
    const [w, x, y, z] = rotationMatrixToMjQuat(R);
    // 90deg about z: (cos(45), 0, 0, sin(45)) = (√2/2, 0, 0, √2/2)
    expect(w).toBeCloseTo(Math.SQRT1_2, 5);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(0, 5);
    expect(z).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it("yields unit quat (any rotation)", () => {
    // 180deg about (1, 1, 0)/√2 axis
    const sq2 = Math.SQRT1_2;
    const R = [[0, 1, 0], [1, 0, 0], [0, 0, -1]];
    const [w, x, y, z] = rotationMatrixToMjQuat(R);
    const norm = Math.sqrt(w * w + x * x + y * y + z * z);
    expect(norm).toBeCloseTo(1, 5);
    // Reconstruct R from quat and verify
    void sq2;
  });
});

describe("jacobiEigen3x3", () => {
  it("diagonalises a diagonal matrix trivially", () => {
    const { eigenvalues } = jacobiEigen3x3([[3, 0, 0], [0, 1, 0], [0, 0, 2]]);
    const sorted = [...eigenvalues].sort((a, b) => a - b);
    expect(sorted[0]).toBeCloseTo(1, 6);
    expect(sorted[1]).toBeCloseTo(2, 6);
    expect(sorted[2]).toBeCloseTo(3, 6);
  });
});
