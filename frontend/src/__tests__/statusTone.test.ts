import { describe, it, expect } from "vitest";
import { statusTone } from "../statusTone";

// The messages below are the actual strings the app passes to setIkStatus
// (Toolbar.tsx, exportConfig.ts, alignment.ts, qualityReport.ts). If a new
// status string is added, extend this list so the chip colours it correctly.

describe("statusTone", () => {
  it("classifies hard failures as error", () => {
    const errors = [
      "Export blocked: 2 error(s). First: \"snout\" → \"nose\": body not in model",
      "Export error: network down",
      "Load error: bad H5",
      "Refit error: singular matrix",
      "Error computing poses: unknown",
      "FSA write failed, falling back to download: denied",
    ];
    for (const m of errors) expect(statusTone(m)).toBe("error");
  });

  it("classifies preconditions, cancellations and warnings as warn", () => {
    const warns = [
      "Save cancelled.",
      "Load cancelled.",
      "XML references mesh files. Pick the model's folder…",
      "Load XML and ACM data first.",
      "No frames available.",
      "Label at least one frame first (Label button on the timeline).",
      "Run IK first — Refit Offsets needs solved poses for the labeled frames.",
      "Labeled frames don't match the last IK result — re-run IK then try again.",
      "Map at least one keypoint first.",
      "Refit produced no offsets (no usable frames).",
      "Config + UI sidecar downloaded. 2 warning(s): \"tail\": no mapping",
    ];
    for (const m of warns) expect(statusTone(m)).toBe("warn");
  });

  it("leaves success and in-progress messages as ok", () => {
    const oks = [
      "Saved to stac_retarget_config.yaml.",
      "Config downloaded.",
      "Loaded STAC: 500 frames, 23 kps, targets synced",
      "Loaded rat.xml (preprocessed 3 mesh geom(s) → 2 capsule, 1 sphere).",
      "Running IK on 5 labeled frames...",
      "Computing poses for 500 frames...",
      "Refit: 30 kp on 5f, err 3.2mm",
    ];
    for (const m of oks) expect(statusTone(m)).toBe("ok");
  });

  it("treats null/empty as ok", () => {
    expect(statusTone(null)).toBe("ok");
    expect(statusTone(undefined)).toBe("ok");
    expect(statusTone("")).toBe("ok");
  });
});
