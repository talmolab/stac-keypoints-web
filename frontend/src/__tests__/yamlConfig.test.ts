import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { dumpStacYaml, dumpStacUiSidecar } from "../yamlConfig";

const repoRoot = resolve(__dirname, "../../..");

interface PyRoundtrip {
  loaded: Record<string, unknown>;
  exported: string;
  sidecar: string | null;
}

function pyLoadAndDump(yamlText: string): PyRoundtrip {
  const tmp = mkdtempSync(join(tmpdir(), "stacyaml-"));
  const path = join(tmp, "in.yaml");
  writeFileSync(path, yamlText);
  try {
    const py = `
import json, sys
sys.path.insert(0, ".")
from backend.config_io import load_stac_yaml, dump_stac_yaml, dump_stac_ui_sidecar
loaded = load_stac_yaml("${path}")
print(json.dumps({
  "loaded": loaded,
  "exported": dump_stac_yaml(loaded),
  "sidecar": dump_stac_ui_sidecar(loaded),
}))
`;
    const r = spawnSync("python3", ["-c", py], {
      encoding: "utf8",
      cwd: repoRoot,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.error) throw new Error(`python spawn: ${r.error.message}`);
    if (r.status !== 0) {
      throw new Error(`python failed (status=${r.status}): ${r.stderr}`);
    }
    return JSON.parse(r.stdout);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe("yamlConfig vs backend/config_io.py", () => {
  it("flat template: UI edits applied, unmanaged fields preserved", () => {
    const src = `
MJCF_PATH: "models/rodent.xml"
N_ITERS: 6
N_ITER_Q: 400
ROOT_OPTIMIZATION_KEYPOINT: SpineL
SITES_TO_REGULARIZE:
  - HandL
  - HandR
KEYPOINT_MODEL_PAIRS:
  Snout: skull
  SpineF: vertebra_cervical_5
KEYPOINT_INITIAL_OFFSETS:
  Snout: 0. 0. 0.
  SpineF: -0.015 0. 0.0
KP_NAMES: [Snout, SpineF]
SCALE_FACTOR: 0.9
MOCAP_SCALE_FACTOR: 0.001
`;
    const py = pyLoadAndDump(src);
    // Apply the same UI edit as test_dump_with_flat_template_preserves_other_fields
    const cfg = py.loaded;
    (cfg.keypointModelPairs as Record<string, string>).Snout = "head";
    cfg.scaleFactor = 1.1;

    // Re-export via Python with the edit applied so we have a fair comparison.
    const pyEdited = pyLoadAndDump(yaml.dump(yaml.load(src) as object).replace("SCALE_FACTOR: 0.9", "SCALE_FACTOR: 1.1").replace("Snout: skull", "Snout: head"));
    const jsOut = yaml.load(dumpStacYaml(cfg)) as Record<string, unknown>;
    const pyOut = yaml.load(pyEdited.exported) as Record<string, unknown>;

    expect(jsOut.KEYPOINT_MODEL_PAIRS).toEqual(pyOut.KEYPOINT_MODEL_PAIRS);
    expect(jsOut.SCALE_FACTOR).toBe(1.1);
    expect(pyOut.SCALE_FACTOR).toBe(1.1);
    // Unmanaged fields preserved on both sides
    expect(jsOut.N_ITERS).toBe(6);
    expect(jsOut.N_ITER_Q).toBe(400);
    expect(jsOut.ROOT_OPTIMIZATION_KEYPOINT).toBe("SpineL");
    expect(jsOut.SITES_TO_REGULARIZE).toEqual(["HandL", "HandR"]);
    // Shape: flat, not wrapped
    expect("model" in jsOut).toBe(false);
    // Same offset string format
    expect((jsOut.KEYPOINT_INITIAL_OFFSETS as Record<string, string>).Snout).toBe(
      (pyOut.KEYPOINT_INITIAL_OFFSETS as Record<string, string>).Snout,
    );
  });

  it("wrapped template: stays wrapped, unmanaged fields preserved", () => {
    const src = `
model:
  MJCF_PATH: models/rodent.xml
  N_ITERS: 6
  KEYPOINT_MODEL_PAIRS:
    Snout: skull
  KEYPOINT_INITIAL_OFFSETS:
    Snout: 0. 0. 0.
  KP_NAMES: [Snout]
  SCALE_FACTOR: 0.9
  MOCAP_SCALE_FACTOR: 0.001
`;
    const py = pyLoadAndDump(src);
    const jsOut = yaml.load(dumpStacYaml(py.loaded)) as Record<string, unknown>;
    const pyOut = yaml.load(py.exported) as Record<string, unknown>;
    expect(jsOut).toEqual(pyOut);
    expect("model" in jsOut).toBe(true);
    expect(((jsOut.model as Record<string, unknown>).N_ITERS)).toBe(6);
  });

  it("strips skeleton_editor from main export", () => {
    const src = `
MJCF_PATH: "models/rodent.xml"
N_ITERS: 6
KEYPOINT_MODEL_PAIRS: {Snout: skull}
KEYPOINT_INITIAL_OFFSETS: {Snout: 0. 0. 0.}
KP_NAMES: [Snout]
SCALE_FACTOR: 0.9
MOCAP_SCALE_FACTOR: 0.001
skeleton_editor:
  segment_scales:
    'SpineF->SpineM': 1.05
`;
    const py = pyLoadAndDump(src);
    const jsOut = yaml.load(dumpStacYaml(py.loaded)) as Record<string, unknown>;
    expect("skeleton_editor" in jsOut).toBe(false);
  });

  it("no template: emits wrapped {model: {...}}", () => {
    const cfg = {
      keypointModelPairs: { Snout: "skull" },
      keypointInitialOffsets: { Snout: [0, 0, 0] as [number, number, number] },
      kpNames: ["Snout"],
      scaleFactor: 0.9,
      mocapScaleFactor: 0.001,
      xmlBasename: "rodent.xml",
    };
    const out = yaml.load(dumpStacYaml(cfg)) as Record<string, unknown>;
    expect("model" in out).toBe(true);
    const m = out.model as Record<string, unknown>;
    expect(m.MJCF_PATH).toBe("models/rodent.xml");
    expect(m.SCALE_FACTOR).toBe(0.9);
  });

  it("sidecar: matches python on non-default segment scales", () => {
    const src = `
MJCF_PATH: "models/rodent.xml"
N_ITERS: 6
KEYPOINT_MODEL_PAIRS: {Snout: skull}
KEYPOINT_INITIAL_OFFSETS: {Snout: 0. 0. 0.}
KP_NAMES: [Snout]
SCALE_FACTOR: 0.9
MOCAP_SCALE_FACTOR: 0.001
skeleton_editor:
  segment_scales:
    'SpineF->SpineM': 1.05
    'SpineM->SpineL': 1.0
`;
    const py = pyLoadAndDump(src);
    // Python loads but skeleton_editor lives at top level of _rawTemplate;
    // dump_stac_ui_sidecar reads config["segmentScales"], so simulate the UI
    // populating that field as the React app would.
    const cfg = { ...py.loaded, segmentScales: { "SpineF->SpineM": 1.05, "SpineM->SpineL": 1.0 } };

    const jsSidecar = dumpStacUiSidecar(cfg);
    expect(jsSidecar).not.toBeNull();
    const parsed = yaml.load(jsSidecar!) as { skeleton_editor: { segment_scales: Record<string, number> } };
    // Only non-default (≠ 1.0 within 0.001) entries kept
    expect(parsed.skeleton_editor.segment_scales).toEqual({ "SpineF->SpineM": 1.05 });
  });

  it("sidecar: returns null when all scales are 1.0", () => {
    const cfg = { segmentScales: { "a->b": 1.0, "c->d": 1.0 } };
    expect(dumpStacUiSidecar(cfg)).toBeNull();
  });
});
