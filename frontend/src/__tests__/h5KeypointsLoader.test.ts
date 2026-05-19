import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { loadKeypointsFromBytes } from "../h5KeypointsLoader";

const repoRoot = resolve(__dirname, "../../..");

interface PyResult {
  keypointNames: string[];
  positions: (number | null)[];
  numFrames: number;
  numKeypoints: number;
  confidences?: (number | null)[];
}

function loadPython(file: string): PyResult {
  const py = `
import json, math, sys
sys.path.insert(0, ".")
from backend.keypoints_io import load_keypoints
out = load_keypoints("${file}")
def fix(v):
    if isinstance(v, list): return [fix(x) for x in v]
    if isinstance(v, float) and math.isnan(v): return None
    return v
print(json.dumps({k: fix(v) for k, v in out.items()}))
`;
  const r = spawnSync("python3", ["-c", py], {
    encoding: "utf8",
    cwd: repoRoot,
    maxBuffer: 1024 * 1024 * 1024, // 1 GiB — synth_stress JSON is ~150 MB
  });
  if (r.error) throw new Error(`python spawn error: ${r.error.message}`);
  if (r.status !== 0) {
    throw new Error(
      `python failed (status=${r.status}, signal=${r.signal}): ${r.stderr || "(stderr empty)"}`,
    );
  }
  return JSON.parse(r.stdout);
}

async function loadJs(file: string): Promise<PyResult> {
  const bytes = new Uint8Array(readFileSync(resolve(repoRoot, file)));
  const out = await loadKeypointsFromBytes(bytes, file.split("/").pop()!);
  if ("error" in out) throw new Error(out.error as string);
  return out as PyResult;
}

function approxEq(a: number | null, b: number | null, eps = 1e-5): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(a - b) < eps;
}

describe("h5KeypointsLoader vs backend/keypoints_io.py", () => {
  it("matches on demo_with_nan.h5 (SLEAP-style with confidences and NaNs)", async () => {
    const file = "data/demo_with_nan.h5";
    const [js, py] = await Promise.all([loadJs(file), Promise.resolve(loadPython(file))]);

    expect(js.numFrames).toBe(py.numFrames);
    expect(js.numKeypoints).toBe(py.numKeypoints);
    expect(js.keypointNames).toEqual(py.keypointNames);
    expect(js.positions.length).toBe(py.positions.length);

    let mismatches = 0;
    let jsNulls = 0;
    let pyNulls = 0;
    for (let i = 0; i < js.positions.length; i++) {
      if (js.positions[i] === null) jsNulls++;
      if (py.positions[i] === null) pyNulls++;
      if (!approxEq(js.positions[i], py.positions[i])) mismatches++;
    }
    expect(mismatches).toBe(0);
    expect(jsNulls).toBe(pyNulls);
    expect(jsNulls).toBeGreaterThan(0); // fixture has NaNs

    expect(js.confidences).toBeDefined();
    expect(js.confidences!.length).toBe(py.confidences!.length);
    let cMis = 0;
    for (let i = 0; i < js.confidences!.length; i++) {
      if (!approxEq(js.confidences![i], py.confidences![i])) cMis++;
    }
    expect(cMis).toBe(0);
  }, 30_000);

  it("matches on synth_stress.h5 (100k frames × 30 kp)", async () => {
    const file = "data/synth_stress.h5";
    const [js, py] = await Promise.all([loadJs(file), Promise.resolve(loadPython(file))]);

    expect(js.numFrames).toBe(py.numFrames);
    expect(js.numKeypoints).toBe(py.numKeypoints);
    expect(js.keypointNames).toEqual(py.keypointNames);
    expect(js.positions.length).toBe(py.positions.length);

    // Spot-check 10 random indices for value parity (full sweep is slow).
    const N = js.positions.length;
    for (let n = 0; n < 1000; n++) {
      const i = Math.floor(Math.random() * N);
      expect(approxEq(js.positions[i], py.positions[i])).toBe(true);
    }
  }, 60_000);
});
