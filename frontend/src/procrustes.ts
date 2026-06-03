/**
 * Rigid / scaled Procrustes alignment via 3×3 SVD.
 *
 * Used by:
 *   - localApi.alignToMujoco — global mocap→MuJoCo fit (scaled)
 *   - mujocoWasm.jacobianIk  — per-frame trunk root init (rigid)
 *
 * The numerical approach matches the backend's scipy-based version
 * (backend/alignment.py) up to float precision.
 */
export type Mat3 = number[][];
export type Vec3 = number[];

/** Symmetric 3×3 eigendecomposition via Jacobi rotations. */
export function jacobiEigen3x3(A: Mat3): {
  eigenvalues: Vec3;
  eigenvectors: Mat3;
} {
  const a = [
    [A[0][0], A[0][1], A[0][2]],
    [A[1][0], A[1][1], A[1][2]],
    [A[2][0], A[2][1], A[2][2]],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let iter = 0; iter < 50; iter++) {
    let maxVal = 0, p = 0, q = 1;
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++)
        if (Math.abs(a[i][j]) > maxVal) {
          maxVal = Math.abs(a[i][j]);
          p = i;
          q = j;
        }
    if (maxVal < 1e-12) break;

    const theta = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(theta), s = Math.sin(theta);

    const ap = [a[0][p], a[1][p], a[2][p]];
    const aq = [a[0][q], a[1][q], a[2][q]];
    for (let i = 0; i < 3; i++) {
      a[i][p] = c * ap[i] - s * aq[i];
      a[i][q] = s * ap[i] + c * aq[i];
    }
    const rp = [a[p][0], a[p][1], a[p][2]];
    const rq = [a[q][0], a[q][1], a[q][2]];
    for (let j = 0; j < 3; j++) {
      a[p][j] = c * rp[j] - s * rq[j];
      a[q][j] = s * rp[j] + c * rq[j];
    }

    const vp = [v[0][p], v[1][p], v[2][p]];
    const vq = [v[0][q], v[1][q], v[2][q]];
    for (let i = 0; i < 3; i++) {
      v[i][p] = c * vp[i] - s * vq[i];
      v[i][q] = s * vp[i] + c * vq[i];
    }
  }

  return { eigenvalues: [a[0][0], a[1][1], a[2][2]], eigenvectors: v };
}

/**
 * SVD-based Procrustes rotation from the 3×3 cross-covariance H = srcCᵀ · tgtC.
 * Returns the rotation R such that `tgt ≈ R · src` (row-vector convention) and
 * the singular values S (used by callers that need the scaled variant).
 *
 * Derivation: for H = U · diag(S) · Vᵀ, the optimal orthogonal rotation in the
 * standard Procrustes problem is Ω = U · Vᵀ. Applied to a column-vector point
 * via Y_col = (X_row · Ω)ᵀ = Ωᵀ · X_col = V · Uᵀ · X_col, hence R = V · Uᵀ.
 */
function rotationFromH(H: Mat3): { R: Mat3; S: Vec3 } {
  const HtH: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) HtH[i][j] += H[k][i] * H[k][j];

  const { eigenvectors: V, eigenvalues } = jacobiEigen3x3(HtH);
  const S = eigenvalues.map((ev) => Math.sqrt(Math.max(0, ev)));

  // U = H · V · diag(1/S) — left singular vectors of H.
  const U: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (S[j] > 1e-10) {
        for (let k = 0; k < 3; k++) {
          U[i][j] += (H[i][k] * V[k][j]) / S[j];
        }
      }
    }
  }

  // R = V · Uᵀ — the rotation to apply as `tgt = R · src` (column vectors).
  let R: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) R[i][j] += V[i][k] * U[j][k];

  // Reflection correction: if det(R) < 0, flip the last column of V before
  // recomputing (equivalent to the standard sign-matrix trick on V·diag·Uᵀ).
  const det =
    R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) -
    R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) +
    R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
  if (det < 0) {
    for (let i = 0; i < 3; i++) V[i][2] = -V[i][2];
    R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        for (let k = 0; k < 3; k++) R[i][j] += V[i][k] * U[j][k];
  }

  return { R, S };
}

function mean3(points: Vec3[]): Vec3 {
  const n = points.length;
  const mu = [0, 0, 0];
  for (const p of points) {
    mu[0] += p[0]; mu[1] += p[1]; mu[2] += p[2];
  }
  return [mu[0] / n, mu[1] / n, mu[2] / n];
}

function centered(points: Vec3[], mu: Vec3): Vec3[] {
  return points.map((p) => [p[0] - mu[0], p[1] - mu[1], p[2] - mu[2]]);
}

function buildH(srcC: Vec3[], tgtC: Vec3[]): Mat3 {
  const H: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < srcC.length; i++)
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) H[r][c] += srcC[i][r] * tgtC[i][c];
  return H;
}

/**
 * Rigid Procrustes: find R, t such that R·src + t best fits tgt (no scale).
 * Returns identity when fewer than three points are supplied.
 */
export function procrustesRigid(
  src: Vec3[],
  tgt: Vec3[],
): { R: Mat3; t: Vec3 } {
  if (src.length !== tgt.length) {
    throw new Error(`procrustesRigid: src (${src.length}) vs tgt (${tgt.length}) length mismatch`);
  }
  if (src.length < 3) {
    return { R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0] };
  }
  const muSrc = mean3(src);
  const muTgt = mean3(tgt);
  const srcC = centered(src, muSrc);
  const tgtC = centered(tgt, muTgt);
  const { R } = rotationFromH(buildH(srcC, tgtC));
  // t = muTgt - R · muSrc
  const t = [0, 0, 0];
  for (let r = 0; r < 3; r++) {
    let rm = 0;
    for (let c = 0; c < 3; c++) rm += R[r][c] * muSrc[c];
    t[r] = muTgt[r] - rm;
  }
  return { R, t };
}

/**
 * Procrustes with uniform scale: find R, t, s such that s·R·src + t best fits tgt.
 * Used by the global Procrustes alignment in alignToMujoco.
 */
export function procrustesScaled(
  src: Vec3[],
  tgt: Vec3[],
): { R: Mat3; t: Vec3; s: number } {
  if (src.length !== tgt.length) {
    throw new Error(`procrustesScaled: src (${src.length}) vs tgt (${tgt.length}) length mismatch`);
  }
  if (src.length < 3) {
    return { R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0], s: 1 };
  }
  const muSrc = mean3(src);
  const muTgt = mean3(tgt);
  const srcC = centered(src, muSrc);
  const tgtC = centered(tgt, muTgt);
  const { R, S } = rotationFromH(buildH(srcC, tgtC));
  let sumSrc2 = 0;
  for (const p of srcC) sumSrc2 += p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
  const s = sumSrc2 > 1e-10 ? (S[0] + S[1] + S[2]) / sumSrc2 : 1.0;
  const t = [0, 0, 0];
  for (let r = 0; r < 3; r++) {
    let rm = 0;
    for (let c = 0; c < 3; c++) rm += R[r][c] * muSrc[c];
    t[r] = muTgt[r] - s * rm;
  }
  return { R, t, s };
}

/** Convert a 3×3 rotation matrix to MuJoCo quaternion (w, x, y, z). */
export function rotationMatrixToMjQuat(R: Mat3): [number, number, number, number] {
  const trace = R[0][0] + R[1][1] + R[2][2];
  let w: number, x: number, y: number, z: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (R[2][1] - R[1][2]) / s;
    y = (R[0][2] - R[2][0]) / s;
    z = (R[1][0] - R[0][1]) / s;
  } else if (R[0][0] > R[1][1] && R[0][0] > R[2][2]) {
    const s = Math.sqrt(1 + R[0][0] - R[1][1] - R[2][2]) * 2;
    w = (R[2][1] - R[1][2]) / s;
    x = 0.25 * s;
    y = (R[0][1] + R[1][0]) / s;
    z = (R[0][2] + R[2][0]) / s;
  } else if (R[1][1] > R[2][2]) {
    const s = Math.sqrt(1 + R[1][1] - R[0][0] - R[2][2]) * 2;
    w = (R[0][2] - R[2][0]) / s;
    x = (R[0][1] + R[1][0]) / s;
    y = 0.25 * s;
    z = (R[1][2] + R[2][1]) / s;
  } else {
    const s = Math.sqrt(1 + R[2][2] - R[0][0] - R[1][1]) * 2;
    w = (R[1][0] - R[0][1]) / s;
    x = (R[0][2] + R[2][0]) / s;
    y = (R[1][2] + R[2][1]) / s;
    z = 0.25 * s;
  }
  return [w, x, y, z];
}
