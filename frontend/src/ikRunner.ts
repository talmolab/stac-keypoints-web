/**
 * Shared IK runner logic — used by both Toolbar buttons and auto-IK hook.
 */
import { useStore } from "./store";
import * as api from "./api";

export interface RunIkOpts {
  /**
   * Seed the solver with the previously rendered pose (`state.liveQpos`)
   * instead of cold-starting — but *only* when re-solving the very frame that
   * pose was solved for (`liveQposFrame === currentFrame`). That is the
   * edit-on-a-fixed-frame case, where the pose is already near-optimal and the
   * warm-start keeps it stable.
   *
   * On a frame change (a scrub) the seed is from a different frame, so even
   * with this flag set we cold-start: the per-frame trunk Procrustes re-seeds
   * the root. Warm-starting a far frame leaves the root mis-oriented and the
   * joints-only refinement can't recover it (the skeleton detaches from the
   * mocap).
   *
   * Use cases:
   *   - Auto-IK (live preview): true. Warm on same-frame edits, cold on scrub.
   *   - Manual Run IK / IK Frame / IK Sequence: false. The user explicitly
   *     asked for a fresh solve; every frame cold-starts.
   */
  warmStart?: boolean;

  /**
   * Progress callback for long multi-frame runs (IK Sequence). Invoked after
   * each frame solves, with the count done and the total. Standalone only —
   * the backend solves server-side in one shot and reports no sub-progress.
   */
  onProgress?: (done: number, total: number) => void;

  /**
   * Polled between frames; return true to stop the run early. Frames already
   * solved are kept and applied (partial result). Standalone only.
   */
  shouldCancel?: () => boolean;
}

/**
 * Run IK on the given frame indices and apply results to the store.
 * Returns true on success.
 */
export async function runIk(
  frameIndices: number[],
  maxIterations = 100,
  opts: RunIkOpts = {},
): Promise<boolean> {
  const state = useStore.getState();
  if (!state.acmPositions || !state.xmlPath) return false;

  const pairs: Record<string, string> = {};
  for (const m of state.mappings) pairs[m.keypointName] = m.bodyName;
  if (Object.keys(pairs).length === 0) return false;

  const offsetMap: Record<string, [number, number, number]> = {};
  for (const o of state.offsets) offsetMap[o.keypointName] = [o.x, o.y, o.z];

  const positions = state.adjustedPositions ?? state.alignedPositions ?? state.acmPositions;

  const initialQpos =
    opts.warmStart &&
    frameIndices.length === 1 &&
    state.liveQpos &&
    state.liveQpos.length === state.nq &&
    state.liveQposFrame === frameIndices[0]
      ? state.liveQpos
      : undefined;

  const result = await api.runQuickStac({
    positions: Array.from(positions),
    numFrames: state.acmNumFrames,
    numKeypoints: state.acmNumKeypoints,
    keypointNames: state.acmKeypointNames,
    xmlPath: state.xmlPath,
    frameIndices,
    mappings: pairs,
    offsets: offsetMap,
    scaleFactor: state.scaleFactor,
    // The model is rendered scaled about the origin by modelScale, so the IK
    // must fit the native model to (keypoints / modelScale) for the rendered
    // bodies to land on the keypoints. localApi.runQuickStac divides the
    // targets by this. (The backend's q_opt ignores it today — standalone-only
    // fix, matching where the slider is actually used.)
    modelScale: state.modelScale,
    mocapScaleFactor: state.mocapScaleFactor,
    maxIterations,
    initialQpos,
    // Cooperative progress/cancel for IK Sequence. The backend path drops these
    // (JSON.stringify ignores functions); localApi.runQuickStac honours them.
    onProgress: opts.onProgress,
    shouldCancel: opts.shouldCancel,
  });

  if (result.error) {
    state.setIkStatus("IK error: " + result.error);
    return false;
  }

  // Only multi-frame runs populate the per-frame scrubbing cache.
  //
  // A single-frame result there poisons Timeline's `stacBodyTransforms`-driven
  // scrub effect — its nearest-frame fallback pins the model to that one
  // frame, so auto-IK firing on scrub would freeze the bug at whatever frame
  // it just solved. Single-frame calls still update `bodyTransforms` and
  // `liveQpos` below, which is all auto-IK / IK Frame actually need.
  if (frameIndices.length > 1) {
    state.setStacResults(result.qpos, result.frameIndices, result.bodyTransforms);
  }

  // Update warm-start cache from the frame matching state.currentFrame,
  // falling back to the last frame in the batch. Record which frame the cached
  // pose belongs to so the next pass only warm-starts when it's that same frame.
  if (result.qpos && result.qpos.length > 0) {
    const matchIdx = result.frameIndices
      ? result.frameIndices.indexOf(state.currentFrame)
      : -1;
    const idx = matchIdx >= 0 ? matchIdx : result.qpos.length - 1;
    const solvedFrame = result.frameIndices
      ? result.frameIndices[idx]
      : state.currentFrame;
    state.setLiveQpos(result.qpos[idx], solvedFrame);
  }

  // Apply body transforms for current frame
  if (result.bodyTransforms && result.bodyTransforms.length > 0) {
    const currentFrame = state.currentFrame;
    const stacIdx = result.frameIndices
      ? result.frameIndices.indexOf(currentFrame)
      : -1;
    if (stacIdx >= 0 && stacIdx < result.bodyTransforms.length) {
      state.setBodyTransforms(result.bodyTransforms[stacIdx]);
    } else {
      state.setBodyTransforms(result.bodyTransforms[0]);
    }
  }

  const meanError =
    result.errors && result.errors.length > 0
      ? (
          (result.errors.reduce((a: number, b: number) => a + b, 0) /
            result.errors.length) *
          1000
        ).toFixed(1)
      : "N/A";
  state.setIkStatus(
    (result.cancelled ? "IK cancelled: " : "IK: ") +
      result.qpos.length + "f, err " + meanError + "mm",
  );
  return true;
}
