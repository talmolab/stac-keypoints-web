/**
 * Shared IK runner logic — used by both Toolbar buttons and auto-IK hook.
 */
import { useStore } from "./store";
import * as api from "./api";

/**
 * Run IK on the given frame indices and apply results to the store.
 * Returns true on success.
 */
export async function runIk(
  frameIndices: number[],
  maxIterations = 100,
): Promise<boolean> {
  const state = useStore.getState();
  if (!state.acmPositions || !state.xmlPath) return false;

  const pairs: Record<string, string> = {};
  for (const m of state.mappings) pairs[m.keypointName] = m.bodyName;
  if (Object.keys(pairs).length === 0) return false;

  const offsetMap: Record<string, [number, number, number]> = {};
  for (const o of state.offsets) offsetMap[o.keypointName] = [o.x, o.y, o.z];

  const positions = state.adjustedPositions ?? state.alignedPositions ?? state.acmPositions;

  const result = await api.runQuickStac({
    positions: Array.from(positions),
    numFrames: state.acmNumFrames,
    numKeypoints: state.acmNumKeypoints,
    keypointNames: state.acmKeypointNames,
    xmlPath: state.xmlPath,
    frameIndices,
    mappings: pairs,
    offsets: offsetMap,
    scaleFactor: state.scaleFactor * state.modelScale,
    mocapScaleFactor: state.mocapScaleFactor,
    maxIterations,
  });

  if (result.error) {
    state.setIkStatus("IK error: " + result.error);
    return false;
  }

  // Store results
  state.setStacResults(result.qpos, result.frameIndices, result.bodyTransforms);

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
    "IK: " + result.qpos.length + "f, err " + meanError + "mm"
  );
  return true;
}
