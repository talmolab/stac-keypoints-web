/**
 * Standalone browser-side API replacement.
 * Provides the same interface as the original api.ts but runs entirely
 * in the browser using mujoco-wasm and bundled static assets.
 */

import {
  initMuJoCo,
  loadXmlFromUrl,
  extractGeometry,
  computeBodyTransforms,
  jacobianIk,
} from "./mujocoWasm";

let cachedAcmData: any = null;
let cachedConfig: any = null;

const DATA_BASE = import.meta.env.BASE_URL + "data/";

export async function loadXml(_path?: string) {
  await initMuJoCo();
  await loadXmlFromUrl(DATA_BASE + "rodent_relaxed.xml");
  return extractGeometry();
}

export async function loadAcmTrials(_maxTrials?: number, _decimate?: number) {
  if (!cachedAcmData) {
    const resp = await fetch(DATA_BASE + "acm_keypoints.json");
    cachedAcmData = await resp.json();
  }
  return cachedAcmData;
}

export async function loadMatFile(_path: string) {
  return loadAcmTrials();
}

export async function loadConfig(_path?: string) {
  if (!cachedConfig) {
    const resp = await fetch(DATA_BASE + "stac_config.json");
    cachedConfig = await resp.json();
  }
  return cachedConfig;
}

export async function exportConfig(
  config: Record<string, unknown>,
  _outputPath: string,
) {
  // In standalone mode, download as a file
  const blob = new Blob([JSON.stringify(config, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "stac_retarget_config.json";
  a.click();
  URL.revokeObjectURL(url);
  return { path: "downloaded" };
}

export async function alignToMujoco(data: Record<string, unknown>) {
  const positions = data.positions as number[];
  const numFrames = data.numFrames as number;
  const numKp = data.numKeypoints as number;
  const kpNames = data.keypointNames as string[];
  const pairs = data.keypointModelPairs as Record<string, string>;
  const scaleFactor = (data.scaleFactor as number) || 0.9;
  const mocapScale = (data.mocapScaleFactor as number) || 0.01;

  // Get MuJoCo body positions at default pose
  const geomInfo = extractGeometry();
  const defaultQpos = new Array(geomInfo.nq).fill(0);
  defaultQpos[3] = 1.0;
  const transforms = computeBodyTransforms(defaultQpos);
  const nameToIdx = Object.fromEntries(
    geomInfo.bodyNames.map((n: string, i: number) => [n, i]),
  );

  // Find common keypoints (those with both ACM data and MuJoCo body mappings)
  const commonKps = kpNames.filter(
    (kp) => kp in pairs && pairs[kp] in nameToIdx,
  );
  if (commonKps.length < 3)
    return { error: "Need >= 3 mapped keypoints for alignment" };

  const kpIdxMap = Object.fromEntries(
    kpNames.map((n, i) => [n, i]),
  );

  // Mean ACM source pose (cm)
  const meanSrc: number[][] = [];
  for (const kp of commonKps) {
    const ki = kpIdxMap[kp];
    let sx = 0,
      sy = 0,
      sz = 0;
    for (let f = 0; f < numFrames; f++) {
      sx += positions[(f * numKp + ki) * 3 + 0];
      sy += positions[(f * numKp + ki) * 3 + 1];
      sz += positions[(f * numKp + ki) * 3 + 2];
    }
    meanSrc.push([sx / numFrames, sy / numFrames, sz / numFrames]);
  }

  // MuJoCo target pose (meters -> cm via scaleFactor / mocapScale)
  const mjTarget: number[][] = [];
  for (const kp of commonKps) {
    const bi = nameToIdx[pairs[kp]];
    const t = transforms[bi];
    mjTarget.push([
      (t.position[0] * scaleFactor) / mocapScale,
      (t.position[1] * scaleFactor) / mocapScale,
      (t.position[2] * scaleFactor) / mocapScale,
    ]);
  }

  // Procrustes alignment: find R, t, s that maps meanSrc -> mjTarget
  const n = commonKps.length;
  const muSrc = [0, 0, 0];
  const muTgt = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < 3; d++) {
      muSrc[d] += meanSrc[i][d] / n;
      muTgt[d] += mjTarget[i][d] / n;
    }
  }

  const srcC = meanSrc.map((p) => [
    p[0] - muSrc[0],
    p[1] - muSrc[1],
    p[2] - muSrc[2],
  ]);
  const tgtC = mjTarget.map((p) => [
    p[0] - muTgt[0],
    p[1] - muTgt[1],
    p[2] - muTgt[2],
  ]);

  // H = srcC^T @ tgtC (3x3 cross-covariance)
  const H = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        H[r][c] += srcC[i][r] * tgtC[i][c];
      }
    }
  }

  // SVD-based Procrustes
  const { R: rotMat, s: scale } = svd3x3Procrustes(H, srcC);

  // t = muTgt - s * R @ muSrc
  const t = [0, 0, 0];
  for (let r = 0; r < 3; r++) {
    let rmu = 0;
    for (let c = 0; c < 3; c++) rmu += rotMat[r][c] * muSrc[c];
    t[r] = muTgt[r] - scale * rmu;
  }

  // Apply to all frames
  const aligned = new Array(positions.length);
  for (let f = 0; f < numFrames; f++) {
    for (let k = 0; k < numKp; k++) {
      const idx = (f * numKp + k) * 3;
      const p = [positions[idx], positions[idx + 1], positions[idx + 2]];
      for (let r = 0; r < 3; r++) {
        let rp = 0;
        for (let c = 0; c < 3; c++) rp += rotMat[r][c] * p[c];
        aligned[idx + r] = scale * rp + t[r];
      }
    }
  }

  return {
    alignedPositions: aligned,
    scale,
    rotation: rotMat,
    translation: t,
    method: "procrustes-browser",
  };
}

// ---------------------------------------------------------------------------
// Simple 3x3 SVD for Procrustes (Jacobi eigendecomposition approach)
// ---------------------------------------------------------------------------

function svd3x3Procrustes(
  H: number[][],
  srcC: number[][],
): { R: number[][]; s: number } {
  // H^T H -> symmetric 3x3
  const HtH = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) HtH[i][j] += H[k][i] * H[k][j];

  // Jacobi eigenvalue decomposition of HtH
  const { eigenvectors: V, eigenvalues } = jacobiEigen3x3(HtH);
  const S = eigenvalues.map((ev) => Math.sqrt(Math.max(0, ev)));

  // U = H V S^-1
  const U = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (S[j] > 1e-10) {
        for (let k = 0; k < 3; k++) {
          U[i][j] += (H[i][k] * V[k][j]) / S[j];
        }
      }
    }
  }

  // R = U V^T
  let R = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) R[i][j] += U[i][k] * V[j][k];

  // Check determinant and correct for reflection
  const det =
    R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) -
    R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) +
    R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
  if (det < 0) {
    for (let i = 0; i < 3; i++) U[i][2] = -U[i][2];
    R = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        for (let k = 0; k < 3; k++) R[i][j] += U[i][k] * V[j][k];
  }

  // Scale: sum(S) / sum(srcC^2)
  const sumS = S.reduce((a, b) => a + b, 0);
  let sumSrc2 = 0;
  for (const p of srcC) sumSrc2 += p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
  const scale = sumSrc2 > 1e-10 ? sumS / sumSrc2 : 1.0;

  return { R, s: scale };
}

function jacobiEigen3x3(A: number[][]): {
  eigenvalues: number[];
  eigenvectors: number[][];
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
    // Find largest off-diagonal element
    let maxVal = 0,
      p = 0,
      q = 1;
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++)
        if (Math.abs(a[i][j]) > maxVal) {
          maxVal = Math.abs(a[i][j]);
          p = i;
          q = j;
        }
    if (maxVal < 1e-12) break;

    const theta = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(theta),
      s = Math.sin(theta);

    // Rotate columns of A
    const ap = [a[0][p], a[1][p], a[2][p]];
    const aq = [a[0][q], a[1][q], a[2][q]];
    for (let i = 0; i < 3; i++) {
      a[i][p] = c * ap[i] - s * aq[i];
      a[i][q] = s * ap[i] + c * aq[i];
    }
    // Rotate rows of A
    const rp = [a[p][0], a[p][1], a[p][2]];
    const rq = [a[q][0], a[q][1], a[q][2]];
    for (let j = 0; j < 3; j++) {
      a[p][j] = c * rp[j] - s * rq[j];
      a[q][j] = s * rp[j] + c * rq[j];
    }

    // Rotate eigenvector matrix
    const vp = [v[0][p], v[1][p], v[2][p]];
    const vq = [v[0][q], v[1][q], v[2][q]];
    for (let i = 0; i < 3; i++) {
      v[i][p] = c * vp[i] - s * vq[i];
      v[i][q] = s * vp[i] + c * vq[i];
    }
  }

  return { eigenvalues: [a[0][0], a[1][1], a[2][2]], eigenvectors: v };
}

// ---------------------------------------------------------------------------
// Remaining API endpoints
// ---------------------------------------------------------------------------

export async function suggestFrames(data: Record<string, unknown>) {
  // Simple uniform sampling for standalone mode
  const numFrames = data.numFrames as number;
  const nSugg = (data.nSuggestions as number) || 8;
  const frames: number[] = [];
  const step = Math.max(1, Math.floor(numFrames / nSugg));
  for (let i = 0; i < numFrames && frames.length < nSugg; i += step)
    frames.push(i);
  return { frames };
}

export async function bodyTransforms(qpos: number[]) {
  return computeBodyTransforms(qpos);
}

export async function loadStacOutput(_path: string) {
  return {
    error: "Not available in standalone mode. Use the backend for H5 loading.",
  };
}

export async function runQuickStac(data: Record<string, unknown>) {
  const positions = data.positions as number[];
  const numFrames = data.numFrames as number;
  const numKp = data.numKeypoints as number;
  const kpNames = data.keypointNames as string[];
  const frameIndices = data.frameIndices as number[];
  const pairs = data.mappings as Record<string, string>;
  const offsetsRaw = data.offsets as Record<string, number[]>;
  const mocapScale = (data.mocapScaleFactor as number) || 0.01;
  const maxIter = (data.maxIterations as number) || 25;

  const allQpos: number[][] = [];
  const allErrors: number[] = [];
  const allTransforms: any[][] = [];

  for (const fi of frameIndices) {
    if (fi >= numFrames) continue;

    // Extract target positions for this frame (cm -> meters)
    const targets: number[][] = [];
    for (let k = 0; k < numKp; k++) {
      const idx = (fi * numKp + k) * 3;
      targets.push([
        positions[idx] * mocapScale,
        positions[idx + 1] * mocapScale,
        positions[idx + 2] * mocapScale,
      ]);
    }

    const result = jacobianIk(targets, kpNames, pairs, offsetsRaw, maxIter);
    allQpos.push(result.qpos);
    allErrors.push(result.error);
    allTransforms.push(result.transforms);
  }

  return {
    qpos: allQpos,
    errors: allErrors,
    frameIndices: frameIndices.slice(0, allQpos.length),
    bodyTransforms: allTransforms,
  };
}

export function setApiBase(_url: string) {
  // no-op in standalone mode
}
export function getCurrentApiBase() {
  return "(standalone)";
}
