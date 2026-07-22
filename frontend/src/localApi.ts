/**
 * Standalone browser-side API replacement.
 * Provides the same interface as the original api.ts but runs entirely
 * in the browser using mujoco-wasm and bundled static assets.
 */

import {
  initMuJoCo,
  loadXmlFromUrl,
  loadXmlFromText,
  loadXmlWithAssets,
  extractGeometry,
  computeBodyTransforms,
  jacobianIk,
  mOptOffsets,
} from "./mujocoWasm";
import { loadKeypointsFromBytes } from "./h5KeypointsLoader";
import { dumpStacYaml, dumpStacUiSidecar } from "./yamlConfig";
import { preprocessMeshfulXml } from "./preprocessMeshfulXml";
import { procrustesScaled } from "./procrustes";

const cachedAcm: Record<string, unknown> = {};
const cachedConfigByPath: Record<string, unknown> = {};

/**
 * Yield control to the event loop so the browser can repaint (progress bar)
 * and dispatch pending input (the Cancel click) between synchronous frame
 * solves. Uses a MessageChannel macrotask, which — unlike `setTimeout(0)` —
 * is not subject to the 4 ms minimum-delay clamp, so the per-frame overhead
 * over a long IK Sequence stays negligible.
 */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(undefined);
  });
}

/** Bundled species index — extend by dropping a dir into `frontend/public/data/`
 * via `scripts/precompute_species.py` (or precompute_assets.py for rat). */
interface BundledSpecies {
  name: string;
  /** Path used by listXmls + loadXml/loadConfig. */
  xmlPath: string;
  configPath: string;
  /** True iff a bundled ACM-style demo dataset accompanies the species. */
  hasDemoData: boolean;
}

const BUNDLED: BundledSpecies[] = [
  {
    name: "rat (bundled, with demo)",
    xmlPath: "data/rat/rodent_relaxed.xml",
    configPath: "data/rat/stac_config.json",
    hasDemoData: true,
  },
  {
    name: "stick (bundled)",
    xmlPath: "data/stick/sungaya_inexpectata_box.xml",
    configPath: "data/stick/stac_config.json",
    hasDemoData: false,
  },
  {
    name: "worm (bundled, mesh→capsule)",
    xmlPath: "data/worm/celegans.xml",
    configPath: "data/worm/stac_config.json",
    hasDemoData: false,
  },
  {
    name: "mouse (bundled, mesh→capsule)",
    xmlPath: "data/mouse/mouse_with_meshes.xml",
    configPath: "data/mouse/stac_config.json",
    hasDemoData: false,
  },
  {
    name: "fly (bundled, mesh→capsule)",
    xmlPath: "data/fly/fruitfly_force.xml",
    configPath: "data/fly/stac_config.json",
    hasDemoData: false,
  },
];

const BUNDLED_BY_XML = Object.fromEntries(BUNDLED.map((s) => [s.xmlPath, s]));

/** True iff `path` names a bundled species that ships in-browser ACM demo
 *  keypoints — i.e. whether "Load ACM" can do anything without a backend. */
export function hasBundledDemo(path?: string | null): boolean {
  return !!(path && BUNDLED_BY_XML[path]?.hasDemoData);
}

/** Resolve a bundled-data URL from a virtual path like `data/rat/foo.json`. */
function bundledUrl(path: string): string {
  return import.meta.env.BASE_URL + path;
}

export function bundledSpecies(): BundledSpecies[] {
  return BUNDLED;
}

export async function loadXml(path?: string) {
  await initMuJoCo();
  const target = path && BUNDLED_BY_XML[path]
    ? path
    : BUNDLED[0].xmlPath;
  await loadXmlFromUrl(bundledUrl(target));
  return extractGeometry();
}

/** Upload a user-supplied MJCF, optionally with companion mesh assets, and
 *  load it into the live model. When mesh assets are present, run the
 *  meshful-XML preprocessor (capsule/sphere replacement) before loading
 *  so the runtime XML has no remaining mesh deps.
 *
 *  `files` shapes:
 *    - one File ending in `.xml`            → loaded as-is
 *    - many Files (one .xml + assets)       → preprocess, then load
 *
 *  When `files[i].webkitRelativePath` is set (folder picker), it's used as
 *  the relative path for asset staging; otherwise asset names default to
 *  the file's basename and we assume meshes are siblings of the XML. */
export async function uploadXml(files: File | File[]) {
  const list = Array.isArray(files) ? files : [files];
  if (list.length === 0) return { error: "No files supplied." };

  const xmlFiles = list.filter((f) => f.name.toLowerCase().endsWith(".xml"));
  if (xmlFiles.length === 0) return { error: "No .xml file in upload." };
  if (xmlFiles.length > 1) {
    return { error: `Multiple .xml files in upload (${xmlFiles.map((f) => f.name).join(", ")}). Pick one.` };
  }
  const xmlFile = xmlFiles[0];
  const xmlText = new TextDecoder("utf-8").decode(await xmlFile.arrayBuffer());

  // Build asset map keyed relative to the XML's directory.
  const xmlRel = xmlFile.webkitRelativePath || xmlFile.name;
  const xmlDir = xmlRel.includes("/") ? xmlRel.replace(/\/[^/]+$/, "") : "";
  const assets = new Map<string, Uint8Array>();
  for (const f of list) {
    if (f === xmlFile) continue;
    const rel = f.webkitRelativePath || f.name;
    let key = rel;
    if (xmlDir && rel.startsWith(xmlDir + "/")) key = rel.slice(xmlDir.length + 1);
    assets.set(key, new Uint8Array(await f.arrayBuffer()));
  }

  // When assets accompany the XML, first try to load it meshful-and-intact so
  // the UI renders real triangle geometry. If that compile fails (missing or
  // unsupported mesh, bad asset), fall back to the capsule/sphere preprocessor
  // so the upload still succeeds — a mesh-less XML makes the preprocessor a
  // no-op (0 replacements). When no assets accompany the XML, try a direct
  // load first; if it fails on missing meshes, surface a hint.
  let finalXml = xmlText;
  let report: { nReplaced: number; nSphere: number; nCapsule: number } | null = null;
  if (assets.size > 0) {
    try {
      await loadXmlWithAssets(xmlText, assets);
      const geom = extractGeometry();
      return { ...geom, xmlPath: xmlFile.name, preprocessReport: null };
    } catch (_meshErr) {
      try {
        const out = await preprocessMeshfulXml(xmlText, assets);
        finalXml = out.xml;
        report = out.report;
      } catch (e) {
        return { error: `Preprocessor failed: ${(e as Error).message}` };
      }
    }
  }

  try {
    await loadXmlFromText(finalXml);
  } catch (e) {
    const msg = (e as Error).message || String(e);
    if (assets.size === 0 && /mesh|file|asset/i.test(msg)) {
      return {
        error:
          "XML references external mesh files. Re-pick the model's *folder* (or select XML + mesh files together) so the preprocessor can bake them into capsules.",
      };
    }
    return { error: `Failed to load XML: ${msg}` };
  }
  const geom = extractGeometry();
  return {
    ...geom,
    xmlPath: xmlFile.name,
    preprocessReport: report,
  };
}

export async function loadAcmTrials(_maxTrials?: number, _decimate?: number) {
  // Only bundled species with demo data have ACM-style fixtures. For others,
  // return an empty result; the Toolbar's "Load Keypoints" upload path is the
  // intended flow.
  const species = BUNDLED[0]; // rat is the only one with demo for now
  if (!species.hasDemoData) {
    return { keypointNames: [], bones: [], positions: [], numFrames: 0, numKeypoints: 0 };
  }
  const url = bundledUrl(species.xmlPath.replace(/\/[^/]+\.xml$/, "/acm_keypoints.json"));
  if (!cachedAcm[url]) {
    const resp = await fetch(url);
    cachedAcm[url] = await resp.json();
  }
  return cachedAcm[url];
}

export async function loadMatFile(_path: string) {
  // Standalone mode can't read server-side paths. Toolbar uses uploadMatFile
  // for user files; this path remains as the legacy "load demo trial" hook.
  return loadAcmTrials();
}

/** Read an uploaded .h5 / .mat v7.3 file via h5wasm. */
export async function uploadKeypoints(file: File, kpNames?: string[]) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return await loadKeypointsFromBytes(bytes, file.name, kpNames);
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Same as uploadKeypoints — backend differentiates the two routes for legacy
 * reasons (.mat used to go through scipy/Monsees pipeline) but in the browser
 * h5wasm handles both cleanly when the .mat is v7.3. */
export async function uploadMatFile(file: File) {
  return uploadKeypoints(file);
}

export async function loadConfig(path?: string) {
  // Resolve config from species table when caller passes a known XML or
  // config path; default to rat's config otherwise.
  let configPath = BUNDLED[0].configPath;
  if (path) {
    const species = BUNDLED_BY_XML[path];
    if (species) configPath = species.configPath;
    else if (BUNDLED.some((s) => s.configPath === path)) configPath = path;
  }
  if (!cachedConfigByPath[configPath]) {
    const resp = await fetch(bundledUrl(configPath));
    cachedConfigByPath[configPath] = await resp.json();
  }
  return cachedConfigByPath[configPath];
}

/** Match api.exportConfig: returns the YAML body as a string. The caller
 * (Toolbar export handler) handles the download itself. */
export async function exportConfig(config: Record<string, unknown>): Promise<string> {
  return dumpStacYaml(config);
}

/** Match api.exportUiSidecar: returns the YAML body or null when empty. */
export async function exportUiSidecar(config: Record<string, unknown>): Promise<string | null> {
  return dumpStacUiSidecar(config);
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

  // Source pose to fit the global rigid+scale on. We deliberately use a SINGLE
  // representative frame (the one the user is viewing) rather than the
  // time-averaged mean over all frames: when the animal walks or turns across
  // the clip, the per-keypoint mean collapses toward the centroid, shrinking
  // the apparent pose to a fraction of its real size. Procrustes then picks a
  // huge scale (e.g. 23x instead of ~8x) to inflate that collapsed blob onto
  // the model, and the rotation it fits is essentially noise. Applying that
  // transform to real (full-size) frames renders the keypoints several times
  // too big and at a meaningless angle. Per-frame fitting avoids both.
  //
  // `frameIndex` is the live current frame. We pick the nearest frame whose
  // mapped keypoints are all present (no NaN), so a gap on the exact current
  // frame doesn't degrade the fit. Falls back to the time-mean only if no
  // frame has a complete set (keeps the old behaviour as a safety net).
  const reqFrame = Math.min(
    Math.max(0, Math.floor((data.frameIndex as number) ?? 0)),
    numFrames - 1,
  );
  const commonKi = commonKps.map((kp) => kpIdxMap[kp]);
  const frameComplete = (f: number): boolean =>
    commonKi.every((ki) => {
      const b = (f * numKp + ki) * 3;
      return (
        Number.isFinite(positions[b]) &&
        Number.isFinite(positions[b + 1]) &&
        Number.isFinite(positions[b + 2])
      );
    });
  // Search outward from the requested frame for the closest complete one.
  let fitFrame = -1;
  for (let d = 0; d < numFrames; d++) {
    if (reqFrame + d < numFrames && frameComplete(reqFrame + d)) { fitFrame = reqFrame + d; break; }
    if (reqFrame - d >= 0 && frameComplete(reqFrame - d)) { fitFrame = reqFrame - d; break; }
  }

  const meanSrc: number[][] = [];
  if (fitFrame >= 0) {
    for (const ki of commonKi) {
      const b = (fitFrame * numKp + ki) * 3;
      meanSrc.push([positions[b], positions[b + 1], positions[b + 2]]);
    }
  } else {
    // No complete frame — fall back to the per-keypoint time mean (nan-aware).
    for (const ki of commonKi) {
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (let f = 0; f < numFrames; f++) {
        const b = (f * numKp + ki) * 3;
        if (Number.isFinite(positions[b]) && Number.isFinite(positions[b + 1]) && Number.isFinite(positions[b + 2])) {
          sx += positions[b]; sy += positions[b + 1]; sz += positions[b + 2]; n++;
        }
      }
      const inv = n > 0 ? 1 / n : 0;
      meanSrc.push([sx * inv, sy * inv, sz * inv]);
    }
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
  const { R: rotMat, t, s: scale } = procrustesScaled(meanSrc, mjTarget);

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
  const initialQpos = data.initialQpos as number[] | undefined;
  // The model is rendered scaled about the origin by modelScale. Fit the native
  // model to keypoints / modelScale so the ×modelScale-rendered bodies overlay
  // the (unscaled) keypoint cloud. modelScale defaults to 1 → no-op.
  const modelScale = (data.modelScale as number) || 1;
  // Cooperative progress + cancellation for long multi-frame runs (IK
  // Sequence). Both are plain callbacks supplied by the in-process caller;
  // they're absent on the backend path (JSON.stringify drops functions) and on
  // the hot single-frame live-preview path, so the per-frame yield below is
  // skipped entirely unless a caller opts in.
  const onProgress = data.onProgress as ((done: number, total: number) => void) | undefined;
  const shouldCancel = data.shouldCancel as (() => boolean) | undefined;
  const wantsCoop = typeof onProgress === "function" || typeof shouldCancel === "function";

  const allQpos: number[][] = [];
  const allErrors: number[] = [];
  const allTransforms: any[][] = [];
  let cancelled = false;

  // Every frame cold-starts via jacobianIk's per-frame trunk Procrustes seed,
  // which re-orients the root correctly for that frame. We do NOT chain
  // warm-starts across frames: jacobianIk runs a fixed iteration count
  // regardless of seed, so chaining buys no speed, and a previous frame's pose
  // is a bad root seed for a frame far away — the joints-only refinement can't
  // rotate the root back, so the skeleton detaches from the mocap on big
  // scrubs. The caller's explicit `initialQpos` is honored only for a
  // single-frame live edit (length-1 batch, frame i === 0).
  for (let i = 0; i < frameIndices.length; i++) {
    const fi = frameIndices[i];
    if (fi >= numFrames) continue;

    // Extract target positions for this frame (cm -> meters), brought into the
    // native (unscaled) model frame by dividing out modelScale.
    const targetScale = mocapScale / modelScale;
    const targets: number[][] = [];
    for (let k = 0; k < numKp; k++) {
      const idx = (fi * numKp + k) * 3;
      targets.push([
        positions[idx] * targetScale,
        positions[idx + 1] * targetScale,
        positions[idx + 2] * targetScale,
      ]);
    }

    const seed = i === 0 ? initialQpos : undefined;
    const result = jacobianIk(
      targets, kpNames, pairs, offsetsRaw, maxIter, 0.3, 0.01, seed,
    );
    allQpos.push(result.qpos);
    // Report the error back in rendered (world) space — the solve ran in the
    // native frame where targets were divided by modelScale.
    allErrors.push(result.error * modelScale);
    allTransforms.push(result.transforms);

    // Between frames: surface progress, then hand the main thread back so the
    // UI can repaint and process a Cancel click before we poll it. Honour the
    // cancel after recording this frame's result, so partial output is usable.
    if (wantsCoop) {
      onProgress?.(allQpos.length, frameIndices.length);
      await yieldToMain();
      if (shouldCancel?.()) {
        cancelled = true;
        break;
      }
    }
  }

  return {
    qpos: allQpos,
    errors: allErrors,
    frameIndices: frameIndices.slice(0, allQpos.length),
    bodyTransforms: allTransforms,
    cancelled,
  };
}

export async function refitOffsets(data: Record<string, unknown>) {
  const positions = data.positions as number[];
  const numFrames = data.numFrames as number;
  const numKp = data.numKeypoints as number;
  const kpNames = data.keypointNames as string[];
  const frameIndices = data.frameIndices as number[];
  const qposesPerFrame = data.qposesPerFrame as number[][];
  const pairs = data.mappings as Record<string, string>;
  const mocapScale = (data.mocapScaleFactor as number) || 0.01;

  if (frameIndices.length !== qposesPerFrame.length) {
    return { error: `frameIndices (${frameIndices.length}) must align with qposesPerFrame (${qposesPerFrame.length})` };
  }
  if (!pairs || Object.keys(pairs).length === 0) {
    return { offsets: {}, error: 0, frameIndicesUsed: [] };
  }

  const kpOrder = Object.keys(pairs);
  const kpIdx: Record<string, number> = {};
  kpNames.forEach((n, i) => { kpIdx[n] = i; });
  for (const kp of kpOrder) {
    if (kpIdx[kp] === undefined) {
      return { error: `Mapped keypoint not present in kp_names: ${kp}` };
    }
  }

  // Skip frames where any mapped keypoint is NaN — same policy as the
  // backend's closed-form solve. Build aligned (qpos, targets) pairs.
  const validIdx: number[] = [];
  const validQ: number[][] = [];
  const validTargets: number[][][] = [];
  for (let t = 0; t < frameIndices.length; t++) {
    const f = frameIndices[t];
    if (f < 0 || f >= numFrames) continue;
    const frameTargets: number[][] = [];
    let anyNan = false;
    for (const kp of kpOrder) {
      const k = kpIdx[kp];
      const i = (f * numKp + k) * 3;
      const x = positions[i] * mocapScale;
      const y = positions[i + 1] * mocapScale;
      const z = positions[i + 2] * mocapScale;
      if (x !== x || y !== y || z !== z) { anyNan = true; break; }
      frameTargets.push([x, y, z]);
    }
    if (anyNan) continue;
    validIdx.push(f);
    validQ.push(qposesPerFrame[t]);
    validTargets.push(frameTargets);
  }

  if (validIdx.length === 0) {
    return { offsets: {}, error: 0, frameIndicesUsed: [] };
  }

  const result = mOptOffsets(validQ, validTargets, pairs);
  return {
    offsets: result.offsets,
    error: result.error,
    frameIndicesUsed: validIdx,
  };
}

export function setApiBase(_url: string) {
  // no-op in standalone mode
}
export function getCurrentApiBase() {
  return "(standalone)";
}
