/**
 * API module — smart routing.
 * Uses Python backend when available (local dev), falls back to
 * browser-side mujoco-wasm (GitHub Pages / standalone).
 */
import * as backend from "./api.backend";
import * as local from "./localApi";

let useBackend: boolean | null = null;

async function checkBackend(): Promise<boolean> {
  if (useBackend !== null) return useBackend;
  try {
    const resp = await fetch("/api/health", { method: "GET", signal: AbortSignal.timeout(1500) });
    const data = await resp.json();
    useBackend = data.status === "ok";
  } catch {
    useBackend = false;
  }
  console.log(`[API] Mode: ${useBackend ? "backend (Python)" : "standalone (browser)"}`);
  return useBackend;
}

// Check on module load
const backendReady = checkBackend();

// Default paths for backend mode
const DEFAULT_XML = "/home/talmolab/Desktop/SalkResearch/stac-mjx/models/rodent_relaxed.xml";
const DEFAULT_CONFIG = "/home/talmolab/Desktop/SalkResearch/monsees-retarget/configs/stac_rodent_acm.yaml";

export async function loadXml(path?: string) {
  if (await backendReady) return backend.loadXml(path || DEFAULT_XML);
  return local.loadXml(path);
}

export async function loadAcmTrials(maxTrials = 5, decimate = 2) {
  if (await backendReady) return backend.loadAcmTrials(maxTrials, decimate);
  return local.loadAcmTrials(maxTrials, decimate);
}

export async function loadMatFile(path: string) {
  if (await backendReady) return backend.loadMatFile(path);
  return local.loadMatFile(path);
}

export async function loadConfig(path?: string) {
  if (await backendReady) return backend.loadConfig(path || DEFAULT_CONFIG);
  return local.loadConfig(path);
}

export async function exportConfig(config: Record<string, unknown>, outputPath: string) {
  if (await backendReady) return backend.exportConfig(config, outputPath);
  return local.exportConfig(config, outputPath);
}

export async function alignToMujoco(data: Record<string, unknown>) {
  if (await backendReady) return backend.alignToMujoco(data);
  return local.alignToMujoco(data);
}

export async function suggestFrames(data: Record<string, unknown>) {
  if (await backendReady) return backend.suggestFrames(data);
  return local.suggestFrames(data);
}

export async function bodyTransforms(qpos: number[]) {
  if (await backendReady) return backend.bodyTransforms(qpos);
  return local.bodyTransforms(qpos);
}

export async function loadStacOutput(path: string) {
  if (await backendReady) return backend.loadStacOutput(path);
  return local.loadStacOutput(path);
}

export async function runQuickStac(data: Record<string, unknown>) {
  if (await backendReady) return backend.runQuickStac(data);
  return local.runQuickStac(data);
}

export function setApiBase(url: string) { backend.setApiBase(url); }
export function getCurrentApiBase() {
  return useBackend ? backend.getCurrentApiBase() || "localhost:8000" : "(standalone/browser)";
}
