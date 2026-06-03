// @vitest-environment happy-dom
//
// Tests for store-level cache invalidation invariants introduced in the
// live-IK pass-1 fixes:
//   - Bug 4: mapping/offset changes clear the cached multi-frame STAC results
//     so scrubbing doesn't show stale per-frame poses.
//   - Bug 5: liveQpos survives mapping/offset edits (used as warm-start) and
//     resets on XML reload (qpos length can change).
//
// Pass-2 (scrub drift) adds liveQposFrame: warm-start is only valid when
// re-solving the same frame the cached pose was solved for; a frame change
// (scrub) must cold-start so the per-frame trunk Procrustes re-seeds the root.

import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../store";

function reset() {
  // Re-seed only the fields these tests touch — easier than mocking createStore.
  useStore.setState({
    mappings: [],
    offsets: [],
    stacQpos: null,
    stacFrameIndices: null,
    stacBodyTransforms: null,
    liveQpos: null,
    liveQposFrame: null,
    currentFrame: 0,
    xmlPath: null,
    geoms: [],
    bodyNames: [],
    nq: 0,
    xmlBasename: null,
  });
}

describe("STAC cache invalidation", () => {
  beforeEach(reset);

  it("addMapping clears cached multi-frame STAC results", () => {
    useStore.getState().setStacResults(
      [[0, 0, 0]],
      [0],
      [[{ bodyId: 0, position: [0, 0, 0], quaternion: [1, 0, 0, 0] }]],
    );
    expect(useStore.getState().stacBodyTransforms).not.toBeNull();

    useStore.getState().addMapping("Snout", "skull");

    expect(useStore.getState().stacQpos).toBeNull();
    expect(useStore.getState().stacFrameIndices).toBeNull();
    expect(useStore.getState().stacBodyTransforms).toBeNull();
  });

  it("removeMapping clears cached multi-frame STAC results", () => {
    useStore.getState().addMapping("Snout", "skull");
    useStore.getState().setStacResults([[0]], [0], [[]]);
    expect(useStore.getState().stacBodyTransforms).not.toBeNull();

    useStore.getState().removeMapping("Snout");

    expect(useStore.getState().stacBodyTransforms).toBeNull();
  });

  it("updateOffset clears cached multi-frame STAC results", () => {
    useStore.getState().setStacResults([[0]], [0], [[]]);
    expect(useStore.getState().stacBodyTransforms).not.toBeNull();

    useStore.getState().updateOffset("Snout", 0.01, 0, 0);

    expect(useStore.getState().stacBodyTransforms).toBeNull();
  });
});

describe("setOffsetsBulk (Refit Offsets)", () => {
  beforeEach(reset);

  it("replaces only the keys it's given; keeps unrelated offsets", () => {
    useStore.getState().updateOffset("Snout", 0.01, 0, 0);
    useStore.getState().updateOffset("SpineL", 0.02, 0, 0);

    useStore.getState().setOffsetsBulk({
      Snout: [0.05, 0.05, 0.05],
      ElbowL: [0.1, 0, 0],
    });

    const offsets = useStore.getState().offsets;
    const byKp = Object.fromEntries(offsets.map((o) => [o.keypointName, [o.x, o.y, o.z]]));
    expect(byKp.Snout).toEqual([0.05, 0.05, 0.05]); // overwritten
    expect(byKp.SpineL).toEqual([0.02, 0, 0]);      // preserved
    expect(byKp.ElbowL).toEqual([0.1, 0, 0]);       // new
  });

  it("clears cached STAC results (same invalidation as updateOffset)", () => {
    useStore.getState().setStacResults([[0]], [0], [[]]);
    expect(useStore.getState().stacBodyTransforms).not.toBeNull();

    useStore.getState().setOffsetsBulk({ Snout: [0.01, 0, 0] });

    expect(useStore.getState().stacBodyTransforms).toBeNull();
  });

  it("pushes a single history snapshot (one undo step, not N)", () => {
    const before = useStore.getState()._undoStack.length;
    useStore.getState().setOffsetsBulk({
      Snout: [0.01, 0, 0],
      SpineF: [0.02, 0, 0],
      SpineM: [0.03, 0, 0],
    });
    expect(useStore.getState()._undoStack.length).toBe(before + 1);
  });
});

describe("liveQpos warm-start lifecycle", () => {
  beforeEach(reset);

  it("survives mapping changes (auto-IK uses it to warm-start)", () => {
    const seed = [1, 2, 3, 4, 5, 6, 7];
    useStore.getState().setLiveQpos(seed);

    useStore.getState().addMapping("Snout", "skull");
    expect(useStore.getState().liveQpos).toEqual(seed);

    useStore.getState().removeMapping("Snout");
    expect(useStore.getState().liveQpos).toEqual(seed);

    useStore.getState().updateOffset("Snout", 0.01, 0, 0);
    expect(useStore.getState().liveQpos).toEqual(seed);
  });

  it("resets on XML reload (qpos length can change)", () => {
    useStore.getState().setLiveQpos([1, 2, 3, 4, 5, 6, 7], 3);

    useStore.getState().setXmlData({
      geoms: [],
      bodyNames: [],
      nq: 21,
      xmlPath: "/foo.xml",
    });

    expect(useStore.getState().liveQpos).toBeNull();
    expect(useStore.getState().liveQposFrame).toBeNull();
  });

  it("records the frame the cached pose was solved for", () => {
    useStore.getState().setLiveQpos([1, 2, 3, 4, 5, 6, 7], 42);
    expect(useStore.getState().liveQposFrame).toBe(42);

    // No frame ⇒ unknown ⇒ never warm-start.
    useStore.getState().setLiveQpos([1, 2, 3, 4, 5, 6, 7]);
    expect(useStore.getState().liveQposFrame).toBeNull();
  });
});

// Mirrors the seed-selection predicate in ikRunner.runIk. Warm-start is opt-in
// (auto-IK only), single-frame, length-matched, AND for the same frame the
// cached pose was solved for. Anything else cold-starts.
function warmStarts(opts: {
  warmStart: boolean;
  frameIndices: number[];
  liveQpos: number[] | null;
  liveQposFrame: number | null;
  nq: number;
}): boolean {
  const { warmStart, frameIndices, liveQpos, liveQposFrame, nq } = opts;
  return !!(
    warmStart &&
    frameIndices.length === 1 &&
    liveQpos &&
    liveQpos.length === nq &&
    liveQposFrame === frameIndices[0]
  );
}

describe("clearAcmData (preset switch)", () => {
  beforeEach(reset);

  it("drops the keypoint clip + IK caches but keeps mappings/offsets", () => {
    // Simulate state after a clip is loaded, aligned, and IK has run.
    useStore.getState().addMapping("Snout", "skull");
    useStore.getState().updateOffset("Snout", 0.01, 0, 0);
    useStore.getState().setAcmData({
      keypointNames: ["Snout"],
      bones: [],
      positions: [0, 0, 0],
      numFrames: 1,
      numKeypoints: 1,
    });
    useStore.getState().setStacResults([[0, 0, 0, 1, 0, 0, 0]], [0], [[]]);
    useStore.getState().setLiveQpos([0, 0, 0, 1, 0, 0, 0], 0);
    expect(useStore.getState().acmPositions).not.toBeNull();

    useStore.getState().clearAcmData();

    const s = useStore.getState();
    // Clip + derived state gone.
    expect(s.acmPositions).toBeNull();
    expect(s.acmKeypointNames).toEqual([]);
    expect(s.acmNumFrames).toBe(0);
    expect(s.isAligned).toBe(false);
    expect(s.stacBodyTransforms).toBeNull();
    expect(s.liveQpos).toBeNull();
    expect(s.liveQposFrame).toBeNull();
    // Mappings/offsets from the new preset's config survive.
    expect(s.mappings).toEqual([{ keypointName: "Snout", bodyName: "skull" }]);
    expect(s.offsets).toEqual([{ keypointName: "Snout", x: 0.01, y: 0, z: 0 }]);
  });
});

describe("warm-start seed selection (scrub vs edit)", () => {
  const base = { warmStart: true, liveQpos: [0, 0, 0, 1, 0, 0, 0], nq: 7 };

  it("warm-starts an edit on the same frame", () => {
    expect(warmStarts({ ...base, frameIndices: [5], liveQposFrame: 5 })).toBe(true);
  });

  it("cold-starts after a scrub to a different frame", () => {
    expect(warmStarts({ ...base, frameIndices: [5], liveQposFrame: 4 })).toBe(false);
    expect(warmStarts({ ...base, frameIndices: [200], liveQposFrame: 0 })).toBe(false);
  });

  it("cold-starts when the cached frame is unknown", () => {
    expect(warmStarts({ ...base, frameIndices: [0], liveQposFrame: null })).toBe(false);
  });

  it("cold-starts a multi-frame batch even if frame 0 matches", () => {
    expect(warmStarts({ ...base, frameIndices: [5, 6, 7], liveQposFrame: 5 })).toBe(false);
  });

  it("cold-starts when warmStart is off (manual buttons)", () => {
    expect(warmStarts({ ...base, warmStart: false, frameIndices: [5], liveQposFrame: 5 })).toBe(false);
  });
});
