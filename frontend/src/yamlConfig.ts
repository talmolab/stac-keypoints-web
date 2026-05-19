/**
 * Browser-side STAC YAML config dumping.
 * Faithful port of backend/config_io.py — same _UI_MANAGED_FIELDS, same
 * flat-vs-wrapped detection, same template-overlay semantics, same key order.
 */

import yaml from "js-yaml";

const MODEL_FIELD_MARKERS = ["KEYPOINT_MODEL_PAIRS", "KP_NAMES", "MJCF_PATH"] as const;

const UI_MANAGED_FIELDS = [
  "MJCF_PATH",
  "SCALE_FACTOR",
  "MOCAP_SCALE_FACTOR",
  "KP_NAMES",
  "KEYPOINT_MODEL_PAIRS",
  "KEYPOINT_INITIAL_OFFSETS",
] as const;

type Dict = Record<string, unknown>;

function isFlat(raw: Dict): boolean {
  return MODEL_FIELD_MARKERS.some((k) => k in raw);
}

function basename(path: string): string {
  if (!path) return "";
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function isAbsolute(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function portableMjcf(config: Dict): string {
  const bn = config.xmlBasename as string | undefined;
  if (bn) return `models/${bn}`;
  const xmlPath = (config.xmlPath as string) || "";
  if (!xmlPath) return "";
  if (isAbsolute(xmlPath)) return `models/${basename(xmlPath)}`;
  return xmlPath;
}

/** Mimic Python's `f"{n}"` for floats: integers get ".0" so "0" → "0.0". */
function pyFloatStr(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return n.toFixed(1);
  return String(n);
}

function offsetsToYaml(offsets: Record<string, [number, number, number]>): Dict {
  const out: Dict = {};
  for (const [kp, v] of Object.entries(offsets)) {
    out[kp] = `${pyFloatStr(v[0])} ${pyFloatStr(v[1])} ${pyFloatStr(v[2])}`;
  }
  return out;
}

function uiManagedFields(config: Dict): Dict {
  const pairs = (config.keypointModelPairs as Dict) || {};
  const offsets = (config.keypointInitialOffsets as Record<string, [number, number, number]>) || {};
  return {
    MJCF_PATH: portableMjcf(config),
    SCALE_FACTOR: config.scaleFactor ?? 0.9,
    MOCAP_SCALE_FACTOR: config.mocapScaleFactor ?? 0.01,
    KP_NAMES: (config.kpNames as string[]) ?? Object.keys(pairs),
    KEYPOINT_MODEL_PAIRS: pairs,
    KEYPOINT_INITIAL_OFFSETS: offsetsToYaml(offsets),
  };
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

function overlayOntoTemplate(template: Dict, ui: Dict): Dict {
  const out: Dict = JSON.parse(JSON.stringify(template));
  delete out.skeleton_editor;

  const target: Dict = isFlat(out)
    ? out
    : ((out.model as Dict) ?? (out.model = {}, out.model as Dict));

  for (const field of UI_MANAGED_FIELDS) {
    const value = ui[field];
    if (isEmpty(value) && !isEmpty(target[field])) continue;
    target[field] = value;
  }
  return out;
}

const DUMP_OPTS: yaml.DumpOptions = {
  flowLevel: -1,
  sortKeys: false,
  lineWidth: -1,
  noRefs: true,
};

/** Serialize UI state to STAC-compatible YAML.
 *
 * If `config._rawTemplate` is present (set by load_stac_yaml on the backend
 * or its eventual JS equivalent), overlay UI edits onto it so unmanaged
 * fields (N_ITERS, ROOT_OPTIMIZATION_KEYPOINT, SITES_TO_REGULARIZE, ...) are
 * preserved. Without a template, emit the UI's wrapped {model: {...}} shape.
 */
export function dumpStacYaml(config: Dict): string {
  const ui = uiManagedFields(config);
  const template = config._rawTemplate as Dict | undefined;
  const yamlDict = template ? overlayOntoTemplate(template, ui) : { model: { ...ui } };
  return yaml.dump(yamlDict, DUMP_OPTS);
}

/** Sidecar YAML for UI-only state (skeleton editor segment scales).
 * Returns null when there's nothing to save — caller should skip the file. */
export function dumpStacUiSidecar(config: Dict): string | null {
  const segmentScales = (config.segmentScales as Record<string, number>) || {};
  const nonDefault: Record<string, number> = {};
  for (const [k, v] of Object.entries(segmentScales)) {
    if (Math.abs(v - 1.0) > 0.001) nonDefault[k] = v;
  }
  if (Object.keys(nonDefault).length === 0) return null;
  return yaml.dump({ skeleton_editor: { segment_scales: nonDefault } }, DUMP_OPTS);
}
