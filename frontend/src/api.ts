const BASE = "";

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
  const resp = await fetch(`${BASE}/api/defaults`);
  if (!resp.ok) throw new Error(`getDefaults: HTTP ${resp.status}`);
  _defaultsCache = await resp.json();
  return _defaultsCache!;
}

export async function loadXml(path: string) {
  const resp = await fetch(`${BASE}/api/load-xml?path=${encodeURIComponent(path)}`, { method: "POST" });
  return resp.json();
}

export async function uploadXml(file: File) {
  const form = new FormData();
  form.append("file", file);
  const resp = await fetch(`${BASE}/api/load-xml`, { method: "POST", body: form });
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

export async function uploadMatFile(file: File) {
  const form = new FormData();
  form.append("file", file);
  const resp = await fetch(`${BASE}/api/load-matfile`, { method: "POST", body: form });
  return resp.json();
}

export async function loadConfig(path: string) {
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

export async function uploadStacOutput(file: File) {
  const form = new FormData();
  form.append("file", file);
  const resp = await fetch(`${BASE}/api/load-stac-output`, { method: "POST", body: form });
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
