/**
 * Browser-side keypoints loader for .h5 (and HDF5-based .mat v7.3).
 * Mirrors backend/keypoints_io.py:load_keypoints — same output dict,
 * NaN→null on positions/confidences (matches store's ReadonlyArray<number|null>).
 */

// h5wasm is dynamically imported on first use (~4 MB) so the SPA's main
// bundle stays slim — h5wasm only enters the network when a user actually
// uploads a keypoint file.
type H5Mod = typeof import("h5wasm");
type H5FileT = InstanceType<H5Mod["File"]>;
let _h5: H5Mod | null = null;
async function getH5(): Promise<H5Mod> {
  if (_h5) return _h5;
  _h5 = await import("h5wasm");
  await _h5.ready;
  return _h5;
}

export interface KeypointsResult {
  keypointNames: string[];
  bones: never[];
  positions: (number | null)[];
  numFrames: number;
  numKeypoints: number;
  confidences?: (number | null)[];
}

function nanToNull(arr: ArrayLike<number>): (number | null)[] {
  const out: (number | null)[] = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    out[i] = Number.isNaN(v) ? null : v;
  }
  return out;
}

function takeFirstAnimalFlat(
  flat: ArrayLike<number>,
  shape: number[],
): { positions: (number | null)[]; numFrames: number; numKeypoints: number } {
  if (shape.length === 4) {
    const [F, A, K, D] = shape;
    if (D !== 3) throw new Error(`tracks last dim must be 3, got ${D}`);
    const out = new Array(F * K * D);
    const animalStride = K * D;
    const frameStride = A * animalStride;
    for (let f = 0; f < F; f++) {
      const src = f * frameStride;
      const dst = f * animalStride;
      for (let i = 0; i < animalStride; i++) {
        out[dst + i] = flat[src + i];
      }
    }
    return { positions: nanToNull(out), numFrames: F, numKeypoints: K };
  }
  if (shape.length === 3) {
    const [F, K, D] = shape;
    if (D !== 3) throw new Error(`positions last dim must be 3, got ${D}`);
    return { positions: nanToNull(flat), numFrames: F, numKeypoints: K };
  }
  throw new Error(`expected 3D or 4D positions array, got shape ${shape}`);
}

function takeFirstAnimalScores(
  flat: ArrayLike<number>,
  shape: number[],
  numFrames: number,
  numKeypoints: number,
): (number | null)[] | undefined {
  if (shape.length === 3) {
    const [F, A, K] = shape;
    if (F !== numFrames || K !== numKeypoints) return undefined;
    const out = new Array(F * K);
    const animalStride = K;
    const frameStride = A * animalStride;
    for (let f = 0; f < F; f++) {
      const src = f * frameStride;
      const dst = f * animalStride;
      for (let i = 0; i < animalStride; i++) {
        out[dst + i] = flat[src + i];
      }
    }
    return nanToNull(out);
  }
  if (shape.length === 2) {
    const [F, K] = shape;
    if (F !== numFrames || K !== numKeypoints) return undefined;
    return nanToNull(flat);
  }
  return undefined;
}

/**
 * Load keypoints from an in-memory file blob. Accepts .h5 and .mat v7.3
 * (which is HDF5 underneath). Throws on non-HDF5 .mat (v5) — caller should
 * surface a "use v7.3 .mat or run the backend" message.
 */
export async function loadKeypointsFromBytes(
  bytes: Uint8Array,
  filename: string,
  callerNames?: string[],
): Promise<KeypointsResult> {
  const h5 = await getH5();
  const vpath = `/work/${filename}`;
  if (!h5.FS!.analyzePath("/work").exists) h5.FS!.mkdir("/work");
  h5.FS!.writeFile(vpath, bytes);

  let f: H5FileT | null = null;
  try {
    f = new h5.File(vpath, "r");
  } catch (e) {
    throw new Error(
      `${filename} is not a valid HDF5 file. ` +
        `If it's a .mat v5 file, convert to v7.3 with MATLAB's ` +
        `\`save('-v7.3')\` or run the local backend (which uses scipy). ` +
        `(${(e as Error).message})`,
    );
  }

  try {
    const keys = f.keys();
    let arrPath: string;
    if (keys.includes("tracks")) arrPath = "tracks";
    else if (keys.includes("positions")) arrPath = "positions";
    else if (keys.includes("pred")) arrPath = "pred"; // .mat v7.3 stac-mjx
    else if (keys.includes("kp_data")) arrPath = "kp_data"; // stac-mjx fit-output H5
    else throw new Error(
      `H5/MAT file has no 'tracks', 'positions', 'pred', or 'kp_data' dataset. Keys: ${keys.join(", ")}`,
    );

    const ds = f.get(arrPath) as { value: ArrayLike<number>; shape: number[] };
    let flat = ds.value;
    let shape = ds.shape;

    // .mat v7.3 stores `pred` as (frames, 3, keypoints) — transpose to (frames, kp, 3).
    if (arrPath === "pred" && shape.length === 3 && shape[1] === 3) {
      const [F, , K] = shape;
      const out = new Float64Array(F * K * 3);
      for (let frame = 0; frame < F; frame++) {
        for (let coord = 0; coord < 3; coord++) {
          for (let k = 0; k < K; k++) {
            out[(frame * K + k) * 3 + coord] = flat[(frame * 3 + coord) * K + k];
          }
        }
      }
      flat = out;
      shape = [F, K, 3];
    }

    // stac-mjx fit-output H5 stores `kp_data` flat as (frames, kp*3) — reshape
    // to (frames, kp, 3). Companion `kp_names` gives K, then we just reinterpret.
    if (arrPath === "kp_data" && shape.length === 2) {
      const [F, KD] = shape;
      let K: number | null = null;
      if (keys.includes("kp_names")) {
        const raw = (f.get("kp_names") as { value: unknown }).value;
        if (Array.isArray(raw)) K = raw.length;
      }
      if (K === null) K = KD / 3;
      if (K * 3 !== KD) {
        throw new Error(
          `kp_data shape ${shape} doesn't match kp_names length ${K}: ${KD} / 3 != ${K}`,
        );
      }
      shape = [F, K, 3];
    }

    const { positions, numFrames, numKeypoints } = takeFirstAnimalFlat(flat, shape);

    let names: string[] | null = null;
    for (const key of ["node_names", "kp_names"]) {
      if (keys.includes(key)) {
        const raw = (f.get(key) as { value: unknown }).value;
        if (Array.isArray(raw)) names = raw.map(String);
        break;
      }
    }
    if (callerNames && callerNames.length === numKeypoints) names = callerNames;
    if (!names || names.length !== numKeypoints) {
      names = Array.from({ length: numKeypoints }, (_, i) => `kp_${i}`);
    }

    let confidences: (number | null)[] | undefined;
    if (keys.includes("point_scores")) {
      const ps = f.get("point_scores") as { value: ArrayLike<number>; shape: number[] };
      confidences = takeFirstAnimalScores(ps.value, ps.shape, numFrames, numKeypoints);
    }

    const out: KeypointsResult = {
      keypointNames: names,
      bones: [],
      positions,
      numFrames,
      numKeypoints,
    };
    if (confidences) out.confidences = confidences;
    return out;
  } finally {
    f.close();
    try { h5.FS!.unlink(vpath); } catch { /* already gone */ }
  }
}
