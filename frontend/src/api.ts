import * as local from "./localApi";

const BASE = "";

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
      xmlPath: "data/rodent_relaxed.xml",
      configPath: "data/stac_config.json",
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
}

export async function listXmls(): Promise<XmlPreset[]> {
  if (!(await backendOk())) {
    return [{ name: "rodent (bundled)", path: "data/rodent_relaxed.xml", root: "bundled" }];
  }
  const resp = await fetch(`${BASE}/api/list-xmls`);
  if (!resp.ok) return [];
  const data = await resp.json();
  return data.presets ?? [];
}

export async function uploadXml(file: File) {
  const form = new FormData();
  form.append("file", file);
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
