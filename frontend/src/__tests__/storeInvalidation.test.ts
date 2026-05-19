// @vitest-environment happy-dom
//
// Tests for store-level cache invalidation invariants introduced in the
// live-IK pass-1 fixes:
//   - Bug 4: mapping/offset changes clear the cached multi-frame STAC results
//     so scrubbing doesn't show stale per-frame poses.
//   - Bug 5: liveQpos survives mapping/offset edits (used as warm-start) and
//     resets on XML reload (qpos length can change).

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
    useStore.getState().setLiveQpos([1, 2, 3, 4, 5, 6, 7]);

    useStore.getState().setXmlData({
      geoms: [],
      bodyNames: [],
      nq: 21,
      xmlPath: "/foo.xml",
    });

    expect(useStore.getState().liveQpos).toBeNull();
  });
});
