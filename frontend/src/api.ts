import * as local from "./localApi";

const API_BASE_KEY = "stac.apiBase";

/** Resolve the backend base URL. Precedence: runtime override (localStorage,
 *  set via the Backend Connection panel) > build-time VITE_API_BASE > "" (same
 *  origin — the historical default; `start.sh` users are unaffected). Trailing
 *  slashes are stripped so `${BASE}/api/...` never doubles up. Pure (sources
 *  injected as args) so it's unit-testable. */
export function resolveApiBase(
  stored?: string | null,
  envBase?: string | null,
): string {
  const raw = (stored && stored.trim()) || (envBase && envBase.trim()) || "";
  return raw.replace(/\/+$/, "");
}

// `let` (not `const`) so a test/tooling can reason about it, but in practice it
// only changes via a full reload — see setApiBase.
let BASE = resolveApiBase(
  typeof localStorage !== "undefined" ? localStorage.getItem(API_BASE_KEY) : null,
  import.meta.env.VITE_API_BASE,
);

/** Current backend base URL ("" = same origin). */
export function getApiBase(): string {
  return BASE;
}

/** Persist a backend base URL and reload. A live swap would have to invalidate
 *  every module-level cache keyed to the old backend (_backendOk, _defaultsCache,
 *  the preset list); a reload re-initialises all of them cleanly, which is fine
 *  for a set-once action. Pass "" to clear the override (fall back to env / same
 *  origin). */
export function setApiBase(url: string): void {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (trimmed) localStorage.setItem(API_BASE_KEY, trimmed);
  else localStorage.removeItem(API_BASE_KEY);
  if (typeof window !== "undefined") window.location.reload();
}

export type BackendStatus = "connected" | "standalone" | "unreachable";

/** Map a health-probe result to a UI status. Pure — split out from probeBackend
 *  so the three-way logic is testable without mocking fetch. "standalone" = no
 *  base set, in-browser by design; "unreachable" = a base IS configured but the
 *  probe failed (surfaced instead of silently falling back to the WASM path). */
export function backendStatusFrom(probeOk: boolean, base: string): BackendStatus {
  if (probeOk) return "connected";
  return base ? "unreachable" : "standalone";
}

/** Probe the configured backend and classify the connection for the indicator. */
export async function probeBackend(): Promise<BackendStatus> {
  return backendStatusFrom(await backendOk(), getApiBase());
}

let _backendOk: boolean | null = null;
let _backendProbe: Promise<boolean> | null = null;

/** One-shot HEAD /api/health probe with 1s timeout. Cached for the session. */
async function backendOk(): Promise<boolean> {
  if (_backendOk !== null) return _backendOk;
  if (_backendProbe) return _backendProbe;
  _backendProbe = (async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1000);
      const r = await fetch(`${BASE}/api/health`, { signal: ctrl.signal });
      clearTimeout(t);
      _backendOk = r.ok;
    } catch {
      _backendOk = false;
    }
    return _backendOk!;
  })();
  return _backendProbe;
}

/** True iff the backend is reachable (resolves after first probe). */
export async function isBackendAvailable(): Promise<boolean> {
  return backendOk();
}

/** Sync check: does `path` name a bundled species with in-browser ACM demo
 *  data? Used to gate the "Load ACM" button in standalone mode, where the
 *  only thing it can load is a bundled demo clip. */
export function xmlHasDemoData(path: string | null): boolean {
  return local.hasBundledDemo(path);
}

export async function health(): Promise<{ status: string }> {
  const resp = await fetch(`${BASE}/api/health`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export interface Defaults {
  xmlPath: string | null;
  configPath: string | null;
  stacOutputPath: string | null;
  acmTrials: number;
  monseesRetarget: string | null;
}

let _defaultsCache: Defaults | null = null;

export async function getDefaults(): Promise<Defaults> {
  if (_defaultsCache) return _defaultsCache;
  if (!(await backendOk())) {
    _defaultsCache = {
      xmlPath: "data/rat/rodent_relaxed.xml",
      configPath: "data/rat/stac_config.json",
      stacOutputPath: null,
      acmTrials: 5,
      monseesRetarget: null,
    };
    return _defaultsCache;
  }
  const resp = await fetch(`${BASE}/api/defaults`);
  if (!resp.ok) throw new Error(`getDefaults: HTTP ${resp.status}`);
  _defaultsCache = await resp.json();
  return _defaultsCache!;
}

export async function loadXml(path: string) {
  if (!(await backendOk())) return local.loadXml(path);
  const resp = await fetch(`${BASE}/api/load-xml?path=${encodeURIComponent(path)}`, { method: "POST" });
  return resp.json();
}

export interface XmlPreset {
  name: string;
  path: string;
  root: string;
  /** Per-species stac_config.json sibling, when one is bundled. Picked up
   *  by the preset dropdown handler so switching species also restores
   *  that species' mappings + `mocapScaleFactor`. */
  configPath?: string;
  /** True iff a bundled demo keypoint clip accompanies this preset (standalone
   *  mode only — rat today). The dropdown handler auto-loads it after the
   *  model+config so re-picking the species restores its markers. */
  hasDemoData?: boolean;
}

export async function listXmls(): Promise<XmlPreset[]> {
  if (!(await backendOk())) {
    return local.bundledSpecies().map((s) => ({
      name: s.name,
      path: s.xmlPath,
      root: "bundled",
      configPath: s.configPath,
      hasDemoData: s.hasDemoData,
    }));
  }
  const resp = await fetch(`${BASE}/api/list-xmls`);
  if (!resp.ok) return [];
  const data = await resp.json();
  return data.presets ?? [];
}

/** Upload an MJCF (with optional companion mesh files) and load it.
 *  Accepts a single File or a list — the local path uses additional files
 *  as mesh assets and runs the in-browser preprocessor. The backend path
 *  uploads only the first .xml (server-side meshes aren't transmitted). */
export async function uploadXml(files: File | File[]) {
  if (!(await backendOk())) return local.uploadXml(files);
  const list = Array.isArray(files) ? files : [files];
  const xmlFile = list.find((f) => f.name.toLowerCase().endsWith(".xml")) ?? list[0];
  const form = new FormData();
  form.append("file", xmlFile);
  const resp = await fetch(`${BASE}/api/load-xml`, { method: "POST", body: form });
  return resp.json();
}

export async function loadAcmTrials(maxTrials = 5, decimate = 2) {
  if (!(await backendOk())) return local.loadAcmTrials(maxTrials, decimate);
  const resp = await fetch(`${BASE}/api/load-acm?max_trials=${maxTrials}&decimate=${decimate}`, { method: "POST" });
  return resp.json();
}

export async function loadMatFile(path: string) {
  if (!(await backendOk())) return local.loadMatFile(path);
  const resp = await fetch(`${BASE}/api/load-matfile?path=${encodeURIComponent(path)}`, { method: "POST" });
  return resp.json();
}

export async function uploadMatFile(file: File) {
  if (!(await backendOk())) return local.uploadMatFile(file);
  const form = new FormData();
  form.append("file", file);
  const resp = await fetch(`${BASE}/api/load-matfile`, { method: "POST", body: form });
  return resp.json();
}

/** Load STAC-format keypoint tracks (.h5 or .mat). No monsees_retarget needed. */
export async function uploadKeypoints(file: File, kpNames?: string[]) {
  if (!(await backendOk())) return local.uploadKeypoints(file, kpNames);
  const form = new FormData();
  form.append("file", file);
  const query = kpNames && kpNames.length > 0
    ? `?kp_names=${encodeURIComponent(kpNames.join(","))}`
    : "";
  const resp = await fetch(`${BASE}/api/load-keypoints${query}`, {
    method: "POST",
    body: form,
  });
  return resp.json();
}

export async function loadConfig(path: string) {
  if (!(await backendOk())) return local.loadConfig(path);
  const resp = await fetch(`${BASE}/api/load-config?path=${encodeURIComponent(path)}`, { method: "POST" });
  return resp.json();
}

export async function uploadConfig(file: File) {
  const form = new FormData();
  form.append("file", file);
  const resp = await fetch(`${BASE}/api/load-config`, { method: "POST", body: form });
  return resp.json();
}

/** Returns the YAML body as a string, or throws on error. */
export async function exportConfig(config: Record<string, unknown>): Promise<string> {
  if (!(await backendOk())) return local.exportConfig(config);
  const resp = await fetch(`${BASE}/api/export-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config }),
  });
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try {
      const err = await resp.json();
      if (err?.error) msg = err.error;
    } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return resp.text();
}

/** UI-only sidecar (skeleton editor, ...). Returns null when there's nothing to save. */
export async function exportUiSidecar(config: Record<string, unknown>): Promise<string | null> {
  if (!(await backendOk())) return local.exportUiSidecar(config);
  const resp = await fetch(`${BASE}/api/export-ui-sidecar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config }),
  });
  if (resp.status === 204) return null;
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try {
      const err = await resp.json();
      if (err?.error) msg = err.error;
    } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return resp.text();
}

export async function alignToMujoco(data: Record<string, unknown>) {
  if (!(await backendOk())) return local.alignToMujoco(data);
  const resp = await fetch(`${BASE}/api/align`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return resp.json();
}

export async function suggestFrames(data: Record<string, unknown>) {
  if (!(await backendOk())) return local.suggestFrames(data);
  const resp = await fetch(`${BASE}/api/suggest-frames`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return resp.json();
}

export async function bodyTransforms(qpos: number[]) {
  if (!(await backendOk())) return local.bodyTransforms(qpos);
  const resp = await fetch(`${BASE}/api/body-transforms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(qpos),
  });
  return resp.json();
}

export async function batchBodyTransforms(qposList: number[][]) {
  const resp = await fetch(`${BASE}/api/batch-body-transforms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ qpos: qposList }),
  });
  return resp.json();
}

export async function loadStacOutput(path: string) {
  if (!(await backendOk())) return local.loadStacOutput(path);
  const resp = await fetch(`${BASE}/api/load-stac-output?path=${encodeURIComponent(path)}`, { method: "POST" });
  return resp.json();
}

export async function uploadStacOutput(file: File) {
  const form = new FormData();
  form.append("file", file);
  const resp = await fetch(`${BASE}/api/load-stac-output`, { method: "POST", body: form });
  return resp.json();
}

export async function runQuickStac(data: Record<string, unknown>) {
  if (!(await backendOk())) return local.runQuickStac(data);
  const resp = await fetch(`${BASE}/api/run-quick-stac`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return resp.json();
}

export async function refitOffsets(data: Record<string, unknown>) {
  // Closed-form m_opt is also implemented in localApi via mujocoWasm,
  // so standalone mode gets Refit Offsets too (numerically identical
  // up to float precision).
  if (!(await backendOk())) return local.refitOffsets(data);
  const resp = await fetch(`${BASE}/api/refit-offsets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return resp.json();
}
