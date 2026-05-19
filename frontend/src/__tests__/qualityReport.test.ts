import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../store";
import { buildQualityReport } from "../qualityReport";

// numFrames=4, numKp=2 (kp0 has 1 NaN frame, kp1 has 0 NaN frames).
const positions = new Float32Array([
  // frame 0
  1, 0, 0,  2, 0, 0,
  // frame 1
  NaN, NaN, NaN,  2, 1, 0,
  // frame 2
  1, 2, 0,  2, 2, 0,
  // frame 3
  1, 3, 0,  2, 3, 0,
]);
// Values are nudged off bin boundaries (e.g. 0.91 not 0.9) because Float32
// rounding can push exact edges into the bin below.
const confidences = new Float32Array([
  // frame 0
  0.91, 0.51,
  // frame 1
  NaN, 0.61,
  // frame 2
  0.96, 0.55,
  // frame 3
  0.99, 0.52,
]);

describe("buildQualityReport", () => {
  beforeEach(() => {
    useStore.setState({
      acmKeypointNames: ["kp0", "kp1"],
      acmPositions: positions,
      acmConfidences: confidences,
      acmNumFrames: 4,
      currentFrame: 0,
      xmlBasename: "test.xml",
      perKeypointErrors: [
        { keypointName: "kp0", errorMm: 5.0 },
        { keypointName: "kp1", errorMm: 1.5 },
      ],
    });
  });

  it("computes per-keypoint gap %", () => {
    const r = buildQualityReport();
    expect(r.perKeypoint).toHaveLength(2);
    expect(r.perKeypoint[0].keypointName).toBe("kp0");
    expect(r.perKeypoint[0].gapPct).toBeCloseTo(0.25, 5);
    expect(r.perKeypoint[1].gapPct).toBeCloseTo(0, 5);
  });

  it("computes per-keypoint mean confidence ignoring NaNs", () => {
    const r = buildQualityReport();
    // kp0: mean of [0.91, 0.96, 0.99]
    expect(r.perKeypoint[0].meanConfidence).toBeCloseTo((0.91 + 0.96 + 0.99) / 3, 4);
    // kp1: mean of [0.51, 0.61, 0.55, 0.52]
    expect(r.perKeypoint[1].meanConfidence).toBeCloseTo((0.51 + 0.61 + 0.55 + 0.52) / 4, 4);
  });

  it("copies per-keypoint errors from store", () => {
    const r = buildQualityReport();
    expect(r.perKeypoint[0].errorMm).toBe(5.0);
    expect(r.perKeypoint[1].errorMm).toBe(1.5);
  });

  it("builds 10-bucket confidence histogram with edges 0..1", () => {
    const r = buildQualityReport();
    expect(r.confidenceHistogram).not.toBeNull();
    const h = r.confidenceHistogram!;
    expect(h.binEdges).toHaveLength(11);
    expect(h.binEdges[0]).toBe(0);
    expect(h.binEdges[10]).toBe(1);
    expect(h.counts).toHaveLength(10);
    // 7 non-NaN samples (8 minus the one NaN at frame 1, kp 0).
    expect(h.nonNanSamples).toBe(7);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(7);
    // Confidences ≥ 0.9 → 3 of them (0.91, 0.96, 0.99). Bin 9 is [0.9, 1.0].
    expect(h.counts[9]).toBe(3);
    // Confidences in [0.5, 0.6) → bin 5: 0.51, 0.55, 0.52 = 3.
    expect(h.counts[5]).toBe(3);
    // Bin 6 is [0.6, 0.7) → 0.61 lands here.
    expect(h.counts[6]).toBe(1);
  });

  it("summary identifies max-gap and max-error keypoint", () => {
    const r = buildQualityReport();
    expect(r.summary.keypointWithMaxGap).toBe("kp0");
    expect(r.summary.maxGapPct).toBeCloseTo(0.25, 5);
    expect(r.summary.keypointWithMaxError).toBe("kp0");
    expect(r.summary.maxErrorMm).toBe(5.0);
    expect(r.summary.meanErrorMm).toBeCloseTo(3.25, 5);
  });
});
