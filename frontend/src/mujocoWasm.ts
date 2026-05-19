/**
 * Browser-side MuJoCo WASM module.
 * Uses the official @mujoco/mujoco package (DeepMind, MuJoCo 3.x WASM bindings).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { procrustesRigid, rotationMatrixToMjQuat } from "./procrustes";

let mjModule: any = null;
let mjModel: any = null;
let mjData: any = null;

// Preferred trunk keypoints for the per-frame root Procrustes seed (rat
// conventions; matches the legacy backend's `_PREFERRED_TRUNK_KEYPOINTS`).
// Non-rat species fall back to "any mapped, non-NaN keypoint" below.
const PREFERRED_TRUNK_KPS = ["SpineL", "SpineM", "SpineF", "Snout"];

/** Cached body name list (computed once after model load). */
let cachedBodyNames: string[] = [];

export async function initMuJoCo(): Promise<void> {
  if (mjModule) return;
  const loadMujoco = (await import("@mujoco/mujoco")).default;
  mjModule = await loadMujoco();
  mjModule.FS.mkdir("/working");
  mjModule.FS.mount(mjModule.MEMFS, { root: "." }, "/working");
}

export async function loadXmlFromUrl(url: string): Promise<void> {
  const resp = await fetch(url);
  const text = await resp.text();
  await loadXmlFromText(text);
}

/**
 * Load a (mesh-less, standalone) MJCF XML supplied as text. Replaces any
 * previously-loaded model. Used by the preprocessor's user-upload flow.
 */
export async function loadXmlFromText(text: string): Promise<void> {
  await initMuJoCo();

  // Clean up any previous model/data
  if (mjData) { mjData.delete(); mjData = null; }
  if (mjModel) { mjModel.delete(); mjModel = null; }

  mjModule.FS.writeFile("/working/model.xml", text);
  mjModel = mjModule.MjModel.mj_loadXML("/working/model.xml");
  mjData = new mjModule.MjData(mjModel);
  mjModule.mj_forward(mjModel, mjData);

  // Cache body names
  const textDecoder = new TextDecoder("utf-8");
  const namesArray = new Uint8Array(mjModel.names);
  cachedBodyNames = [];
  for (let b = 0; b < mjModel.nbody; b++) {
    const nameAdr = mjModel.name_bodyadr[b];
    let end = nameAdr;
    while (end < namesArray.length && namesArray[end] !== 0) end++;
    cachedBodyNames.push(textDecoder.decode(namesArray.subarray(nameAdr, end)));
  }
}

export function getModel() { return mjModel; }
export function getData() { return mjData; }
export function getMjModule() { return mjModule; }

/**
 * Extract geometry data from the loaded MuJoCo model.
 * Returns the same shape the backend's extract_model_geometry returned.
 */
export function extractGeometry() {
  if (!mjModel || !mjData) throw new Error("Model not loaded");
  const mj = mjModule;

  // Read geom type enum values from the module
  const GEOM_NAMES: Record<number, string> = {};
  GEOM_NAMES[mj.mjtGeom.mjGEOM_SPHERE.value] = "sphere";
  GEOM_NAMES[mj.mjtGeom.mjGEOM_CAPSULE.value] = "capsule";
  GEOM_NAMES[mj.mjtGeom.mjGEOM_CYLINDER.value] = "cylinder";
  GEOM_NAMES[mj.mjtGeom.mjGEOM_ELLIPSOID.value] = "ellipsoid";
  GEOM_NAMES[mj.mjtGeom.mjGEOM_BOX.value] = "box";
  const PLANE_TYPE = mj.mjtGeom.mjGEOM_PLANE.value;

  const geoms: any[] = [];
  for (let g = 0; g < mjModel.ngeom; g++) {
    const geomType = mjModel.geom_type[g];
    if (geomType === PLANE_TYPE) continue;
    if (mjModel.geom_group[g] >= 3) continue;

    const typeName = GEOM_NAMES[geomType] || "unknown";
    const bodyId = mjModel.geom_bodyid[g];
    geoms.push({
      type: typeName,
      bodyId,
      bodyName: cachedBodyNames[bodyId] || "",
      size: [
        mjModel.geom_size[g * 3],
        mjModel.geom_size[g * 3 + 1],
        mjModel.geom_size[g * 3 + 2],
      ],
      position: [
        mjModel.geom_pos[g * 3],
        mjModel.geom_pos[g * 3 + 1],
        mjModel.geom_pos[g * 3 + 2],
      ],
      quaternion: [
        mjModel.geom_quat[g * 4],
        mjModel.geom_quat[g * 4 + 1],
        mjModel.geom_quat[g * 4 + 2],
        mjModel.geom_quat[g * 4 + 3],
      ],
      color: [
        mjModel.geom_rgba[g * 4],
        mjModel.geom_rgba[g * 4 + 1],
        mjModel.geom_rgba[g * 4 + 2],
        mjModel.geom_rgba[g * 4 + 3],
      ],
    });
  }

  return {
    geoms,
    nq: mjModel.nq,
    nv: mjModel.nv,
    nbody: mjModel.nbody,
    bodyNames: cachedBodyNames,
  };
}

/**
 * Set qpos and run mj_forward, returning body transforms.
 */
export function computeBodyTransforms(qpos: number[]) {
  if (!mjModel || !mjData) throw new Error("Model not loaded");
  for (let i = 0; i < qpos.length && i < mjModel.nq; i++) {
    mjData.qpos[i] = qpos[i];
  }
  mjModule.mj_forward(mjModel, mjData);

  const transforms: {
    bodyId: number;
    position: [number, number, number];
    quaternion: [number, number, number, number];
  }[] = [];
  for (let b = 0; b < mjModel.nbody; b++) {
    transforms.push({
      bodyId: b,
      position: [
        mjData.xpos[b * 3],
        mjData.xpos[b * 3 + 1],
        mjData.xpos[b * 3 + 2],
      ],
      quaternion: [
        mjData.xquat[b * 4],
        mjData.xquat[b * 4 + 1],
        mjData.xquat[b * 4 + 2],
        mjData.xquat[b * 4 + 3],
      ],
    });
  }
  return transforms;
}

/**
 * Jacobian-based IK. Matches keypoints to MuJoCo body positions.
 */
export function jacobianIk(
  targetPositions: number[][], // (numKp, 3) in meters
  kpNames: string[],
  kpBodyMap: Record<string, string>,
  offsets: Record<string, number[]>,
  maxIter: number = 25,
  step: number = 0.3,
  damping: number = 0.01,
  initialQpos?: number[] | null,
) {
  if (!mjModel || !mjData || !mjModule) throw new Error("Model not loaded");

  const nameToBodyId: Record<string, number> = {};
  cachedBodyNames.forEach((n, i) => { nameToBodyId[n] = i; });

  const nv = mjModel.nv;
  const nq = mjModel.nq;

  if (initialQpos && initialQpos.length === nq) {
    // Warm-start from the caller's pose — typically the previously solved
    // qpos for this frame. Skips the trunk Procrustes root seed entirely.
    for (let i = 0; i < nq; i++) mjData.qpos[i] = initialQpos[i];
  } else {
    // Cold start: per-frame rigid Procrustes from the default-pose MuJoCo
    // trunk onto the current-frame keypoint trunk gives the rat its actual
    // orientation. Without this the joints-only IK can never rotate the
    // root — the rat sits upright while the mocap is in whatever pose, and
    // limbs fail to snap. Matches the pre-milestone-6 backend behaviour
    // (legacy `stac_runner._jacobian_ik` + its Procrustes block).
    mjModule.mj_resetData(mjModel, mjData);
    mjModule.mj_forward(mjModel, mjData);

    const kpIndex: Record<string, number> = {};
    kpNames.forEach((n, i) => { kpIndex[n] = i; });
    const isFinite = (kp: string): boolean => {
      const i = kpIndex[kp];
      if (i === undefined) return false;
      const t = targetPositions[i];
      return !!t && t[0] === t[0] && t[1] === t[1] && t[2] === t[2];
    };
    const isUsable = (kp: string): boolean =>
      kp in kpBodyMap && nameToBodyId[kpBodyMap[kp]] !== undefined && isFinite(kp);

    let trunkKps = PREFERRED_TRUNK_KPS.filter(isUsable);
    if (trunkKps.length < 3) {
      // Non-rat species or sparse mappings: align against whatever we have.
      trunkKps = kpNames.filter(isUsable);
    }

    if (trunkKps.length >= 3) {
      const mjTrunk: number[][] = [];
      const acmTrunk: number[][] = [];
      for (const kp of trunkKps) {
        const bi = nameToBodyId[kpBodyMap[kp]];
        const off = offsets[kp] || [0, 0, 0];
        mjTrunk.push([
          mjData.xpos[bi * 3] + off[0],
          mjData.xpos[bi * 3 + 1] + off[1],
          mjData.xpos[bi * 3 + 2] + off[2],
        ]);
        const ti = kpIndex[kp];
        acmTrunk.push([
          targetPositions[ti][0],
          targetPositions[ti][1],
          targetPositions[ti][2],
        ]);
      }
      const { R, t } = procrustesRigid(mjTrunk, acmTrunk);
      const [qw, qx, qy, qz] = rotationMatrixToMjQuat(R);
      mjData.qpos[0] = t[0];
      mjData.qpos[1] = t[1];
      mjData.qpos[2] = t[2];
      mjData.qpos[3] = qw;
      mjData.qpos[4] = qx;
      mjData.qpos[5] = qy;
      mjData.qpos[6] = qz;
    } else {
      // No usable trunk pairs (very sparse mapping, all-NaN frame). Fall
      // back to the old mean-of-targets seed — at least gets the root near
      // the cloud.
      let mx = 0, my = 0, mz = 0, n = 0;
      for (const t of targetPositions) {
        if (t && t[0] === t[0] && t[1] === t[1] && t[2] === t[2]) {
          mx += t[0]; my += t[1]; mz += t[2]; n++;
        }
      }
      if (n > 0) {
        mjData.qpos[0] = mx / n; mjData.qpos[1] = my / n; mjData.qpos[2] = mz / n;
      }
      mjData.qpos[3] = 1; mjData.qpos[4] = 0; mjData.qpos[5] = 0; mjData.qpos[6] = 0;
    }
  }

  const jacp = new Float64Array(3 * nv);

  let bestError = Infinity;
  let bestQpos = new Float64Array(nq);

  for (let iter = 0; iter < maxIter; iter++) {
    mjModule.mj_forward(mjModel, mjData);

    const grad = new Float64Array(nv);
    let totalError = 0;

    for (let k = 0; k < kpNames.length; k++) {
      const kpName = kpNames[k];
      const bodyName = kpBodyMap[kpName];
      if (!bodyName) continue;
      const bodyId = nameToBodyId[bodyName];
      if (bodyId === undefined) continue;

      const offset = offsets[kpName] || [0, 0, 0];
      const target = targetPositions[k];

      const cx = mjData.xpos[bodyId * 3] + offset[0];
      const cy = mjData.xpos[bodyId * 3 + 1] + offset[1];
      const cz = mjData.xpos[bodyId * 3 + 2] + offset[2];

      const ex = target[0] - cx;
      const ey = target[1] - cy;
      const ez = target[2] - cz;
      totalError += Math.sqrt(ex * ex + ey * ey + ez * ez);

      // Compute Jacobian for this body
      jacp.fill(0);
      mjModule.mj_jacBody(mjModel, mjData, jacp, null, bodyId);

      // J^T @ error -> gradient (skip freejoint 6 DOFs)
      for (let j = 6; j < nv; j++) {
        grad[j] +=
          jacp[0 * nv + j] * ex +
          jacp[1 * nv + j] * ey +
          jacp[2 * nv + j] * ez;
      }
    }

    if (totalError < bestError) {
      bestError = totalError;
      for (let i = 0; i < nq; i++) bestQpos[i] = mjData.qpos[i];
    }

    // Update joint angles (qpos[7:] maps to qvel[6:])
    const gradNorm = Math.sqrt(grad.reduce((s, v) => s + v * v, 0)) + damping;
    for (let j = 6; j < nv; j++) {
      mjData.qpos[7 + (j - 6)] += step * grad[j] / gradNorm;
    }

    // Clamp to joint limits
    for (let j = 0; j < mjModel.njnt; j++) {
      if (mjModel.jnt_limited[j]) {
        const addr = mjModel.jnt_qposadr[j];
        const lo = mjModel.jnt_range[j * 2];
        const hi = mjModel.jnt_range[j * 2 + 1];
        if (mjData.qpos[addr] < lo) mjData.qpos[addr] = lo;
        if (mjData.qpos[addr] > hi) mjData.qpos[addr] = hi;
      }
    }
  }

  // Restore best
  for (let i = 0; i < nq; i++) mjData.qpos[i] = bestQpos[i];
  mjModule.mj_forward(mjModel, mjData);

  // Get final qpos and transforms
  const qpos = Array.from(bestQpos);
  const transforms = computeBodyTransforms(qpos);

  return { qpos, transforms, error: bestError / kpNames.length };
}

/**
 * Closed-form marker-offset solve — JS port of stac_mjx._m_opt with
 * reg_coef=0. For each mapped keypoint k whose parent body is b_k,
 *
 *     m_k* = (Σₜ Rₜᵀ (yₜ - pₜ)) / T
 *
 * where (pₜ, Rₜ) are b_k's world position and rotation at frame t after
 * mj_forward(qposₜ), and yₜ is the observed marker target. Frames where
 * the target is NaN are dropped per-keypoint. Returns the new local
 * offsets per keypoint name (meters, parent-body local frame).
 *
 * Closed-form so it's just T forward-kinematics calls (one per labeled
 * frame) + linear algebra. Numerically identical to the backend's
 * StacCore.m_opt(reg_coef=0) modulo float precision.
 */
export function mOptOffsets(
  qposesPerFrame: number[][],          // T qposes, one per sample frame
  targetsPerFrame: number[][][],       // T frames × K mapped keypoints × 3
  kpBodyMap: Record<string, string>,   // ordered: keys give kp_order
): { offsets: Record<string, [number, number, number]>; error: number; framesUsed: number } {
  if (!mjModel || !mjData || !mjModule) throw new Error("Model not loaded");
  if (qposesPerFrame.length !== targetsPerFrame.length) {
    throw new Error(
      `qposesPerFrame (${qposesPerFrame.length}) must align with targetsPerFrame (${targetsPerFrame.length})`,
    );
  }

  const nameToBodyId: Record<string, number> = {};
  cachedBodyNames.forEach((n, i) => { nameToBodyId[n] = i; });

  const kpOrder = Object.keys(kpBodyMap);
  const K = kpOrder.length;
  const bodyIds: number[] = kpOrder.map((kp) => {
    const id = nameToBodyId[kpBodyMap[kp]];
    if (id === undefined) throw new Error(`Body not found for ${kp}: ${kpBodyMap[kp]}`);
    return id;
  });

  // Accumulators: sum of R^T (y - p) per keypoint, and per-kp finite-count.
  const acc = new Float64Array(K * 3);
  const counts = new Int32Array(K);
  let totalErrSq = 0;
  let totalContribs = 0;

  const T = qposesPerFrame.length;
  for (let t = 0; t < T; t++) {
    const q = qposesPerFrame[t];
    if (q.length !== mjModel.nq) {
      throw new Error(`frame ${t}: qpos length ${q.length} != model nq ${mjModel.nq}`);
    }
    for (let i = 0; i < q.length; i++) mjData.qpos[i] = q[i];
    mjModule.mj_forward(mjModel, mjData);

    const targets = targetsPerFrame[t];
    for (let k = 0; k < K; k++) {
      const y = targets[k];
      if (y[0] !== y[0] || y[1] !== y[1] || y[2] !== y[2]) continue; // NaN drop

      const b = bodyIds[k];
      const px = mjData.xpos[b * 3 + 0];
      const py = mjData.xpos[b * 3 + 1];
      const pz = mjData.xpos[b * 3 + 2];
      const zx = y[0] - px;
      const zy = y[1] - py;
      const zz = y[2] - pz;

      // xmat is row-major 3x3 per body. (R^T z)[j] = sum_i R[i,j] * z[i].
      const m = b * 9;
      acc[k * 3 + 0] += mjData.xmat[m + 0] * zx + mjData.xmat[m + 3] * zy + mjData.xmat[m + 6] * zz;
      acc[k * 3 + 1] += mjData.xmat[m + 1] * zx + mjData.xmat[m + 4] * zy + mjData.xmat[m + 7] * zz;
      acc[k * 3 + 2] += mjData.xmat[m + 2] * zx + mjData.xmat[m + 5] * zy + mjData.xmat[m + 8] * zz;
      counts[k] += 1;
      totalErrSq += zx * zx + zy * zy + zz * zz;
      totalContribs += 1;
    }
  }

  // m_k = acc_k / count_k. A keypoint with zero finite frames keeps its
  // existing offset (caller decides what to do — we return [0,0,0] which
  // setOffsetsBulk replaces; if you'd rather skip, filter on counts[k]).
  const offsets: Record<string, [number, number, number]> = {};
  for (let k = 0; k < K; k++) {
    const c = counts[k];
    if (c === 0) continue;
    offsets[kpOrder[k]] = [
      acc[k * 3 + 0] / c,
      acc[k * 3 + 1] / c,
      acc[k * 3 + 2] / c,
    ];
  }

  // Mean per-keypoint Euclidean residual at the *pre-solve* targets — gives
  // the user a sense of how far off the rendered markers were. The post-
  // solve error would require a second FK pass; the rendered scene will
  // show the new fit anyway once auto-IK re-runs.
  const meanErr = totalContribs > 0 ? Math.sqrt(totalErrSq / totalContribs) : 0;

  return { offsets, error: meanErr, framesUsed: T };
}
