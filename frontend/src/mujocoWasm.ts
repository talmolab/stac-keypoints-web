/**
 * Browser-side MuJoCo WASM module.
 * Provides geometry extraction, body transforms, and Jacobian IK
 * using the mujoco-js (mujoco-wasm) package.
 *
 * API patterns based on the mujoco-wasm demo:
 *   import load_mujoco from "mujoco-js/dist/mujoco_wasm.js";
 *   const mujoco = await load_mujoco();
 *   mujoco.FS.mkdir('/working');
 *   mujoco.FS.mount(mujoco.MEMFS, { root: '.' }, '/working');
 *   mujoco.FS.writeFile("/working/model.xml", xmlText);
 *   let model = mujoco.MjModel.loadFromXML("/working/model.xml");
 *   let data  = new mujoco.MjData(model);
 *   mujoco.mj_forward(model, data);
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

let mjModule: any = null;
let mjModel: any = null;
let mjData: any = null;

/** Cached body name list (computed once after model load). */
let cachedBodyNames: string[] = [];

export async function initMuJoCo(): Promise<void> {
  if (mjModule) return;
  const loadMujoco = (await import("mujoco-js/dist/mujoco_wasm.js")).default;
  mjModule = await loadMujoco();
  mjModule.FS.mkdir("/working");
  mjModule.FS.mount(mjModule.MEMFS, { root: "." }, "/working");
}

export async function loadXmlFromUrl(url: string): Promise<void> {
  await initMuJoCo();

  // Clean up any previous model/data
  if (mjData) { mjData.delete(); mjData = null; }
  if (mjModel) { mjModel.delete(); mjModel = null; }

  const resp = await fetch(url);
  const text = await resp.text();
  mjModule.FS.writeFile("/working/model.xml", text);
  mjModel = mjModule.MjModel.loadFromXML("/working/model.xml");
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
) {
  if (!mjModel || !mjData || !mjModule) throw new Error("Model not loaded");

  const nameToBodyId: Record<string, number> = {};
  cachedBodyNames.forEach((n, i) => { nameToBodyId[n] = i; });

  const nv = mjModel.nv;
  const nq = mjModel.nq;

  // Set root position from mean of targets
  let mx = 0, my = 0, mz = 0;
  for (const t of targetPositions) { mx += t[0]; my += t[1]; mz += t[2]; }
  mx /= targetPositions.length;
  my /= targetPositions.length;
  mz /= targetPositions.length;
  mjData.qpos[0] = mx;
  mjData.qpos[1] = my;
  mjData.qpos[2] = mz;
  // Quaternion identity
  mjData.qpos[3] = 1;
  mjData.qpos[4] = 0;
  mjData.qpos[5] = 0;
  mjData.qpos[6] = 0;

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
