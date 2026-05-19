/**
 * Standalone browser-side API replacement.
 * Provides the same interface as the original api.ts but runs entirely
 * in the browser using mujoco-wasm and bundled static assets.
 */

import {
  initMuJoCo,
  loadXmlFromUrl,
  loadXmlFromText,
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

  // Always run through the preprocessor when assets are supplied — even if
  // the XML happens to be mesh-less, it's a no-op and the report shows 0
  // replacements. When no assets accompany the XML, try a direct load
  // first; if it fails on missing meshes, surface a hint.
  let finalXml = xmlText;
  let report: { nReplaced: number; nSphere: number; nCapsule: number } | null = null;
  if (assets.size > 0) {
    try {
      const out = await preprocessMeshfulXml(xmlText, assets);
      finalXml = out.xml;
      report = out.report;
    } catch (e) {
      return { error: `Preprocessor failed: ${(e as Error).message}` };
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

  const allQpos: number[][] = [];
  const allErrors: number[] = [];
  const allTransforms: any[][] = [];

  // Use the explicit seed only for the first frame in this batch. Subsequent
  // frames warm-start from the previous frame's solve (temporal coherence).
  let warmStart: number[] | undefined = initialQpos;

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

    const result = jacobianIk(
      targets, kpNames, pairs, offsetsRaw, maxIter, 0.3, 0.01, warmStart,
    );
    allQpos.push(result.qpos);
    allErrors.push(result.error);
    allTransforms.push(result.transforms);
    warmStart = result.qpos;
  }

  return {
    qpos: allQpos,
    errors: allErrors,
    frameIndices: frameIndices.slice(0, allQpos.length),
    bodyTransforms: allTransforms,
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
