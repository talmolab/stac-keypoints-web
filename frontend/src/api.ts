/**
 * API base URL. In dev mode (Vite proxy), this is empty.
 * When deployed to GitHub Pages, set via localStorage or URL param
 * to point to the local backend (e.g., "http://localhost:8000").
 */
function getApiBase(): string {
  // Check URL param first: ?api=http://localhost:8000
  const params = new URLSearchParams(window.location.search);
  const urlParam = params.get("api");
  if (urlParam) return urlParam;
  // Check localStorage
  const stored = localStorage.getItem("stac-retarget-api-base");
  if (stored) return stored;
  // Default: same origin (works with Vite proxy in dev)
  return "";
}

const BASE = getApiBase();

/** Update the API base URL and reload. */
export function setApiBase(url: string) {
  localStorage.setItem("stac-retarget-api-base", url);
  window.location.reload();
}

/** Get current API base URL. */
export function getCurrentApiBase(): string {
  return BASE;
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
