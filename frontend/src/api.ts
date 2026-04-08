const BASE = "";

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
  const resp = await fetch(`${BASE}/api/defaults`);
  if (!resp.ok) throw new Error(`getDefaults: HTTP ${resp.status}`);
  _defaultsCache = await resp.json();
  return _defaultsCache!;
}

export async function loadXml(path: string) {
  const resp = await fetch(`${BASE}/api/load-xml?path=${encodeURIComponent(path)}`, { method: "POST" });
  return resp.json();
}

export async function loadAcmTrials(maxTrials = 5, decimate = 2) {
  const resp = await fetch(`${BASE}/api/load-acm?max_trials=${maxTrials}&decimate=${decimate}`, { method: "POST" });
  return resp.json();
}

export async function loadMatFile(path: string) {
  const resp = await fetch(`${BASE}/api/load-matfile?path=${encodeURIComponent(path)}`, { method: "POST" });
  return resp.json();
}

export async function loadConfig(path: string) {
  const resp = await fetch(`${BASE}/api/load-config?path=${encodeURIComponent(path)}`, { method: "POST" });
  return resp.json();
}

export async function exportConfig(config: Record<string, unknown>, outputPath: string) {
  const resp = await fetch(`${BASE}/api/export-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config, outputPath }),
  });
  return resp.json();
}

export async function alignToMujoco(data: Record<string, unknown>) {
  const resp = await fetch(`${BASE}/api/align`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return resp.json();
}

export async function suggestFrames(data: Record<string, unknown>) {
  const resp = await fetch(`${BASE}/api/suggest-frames`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return resp.json();
}

export async function bodyTransforms(qpos: number[]) {
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
  const resp = await fetch(`${BASE}/api/load-stac-output?path=${encodeURIComponent(path)}`, { method: "POST" });
  return resp.json();
}

export async function runQuickStac(data: Record<string, unknown>) {
  const resp = await fetch(`${BASE}/api/run-quick-stac`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return resp.json();
}
