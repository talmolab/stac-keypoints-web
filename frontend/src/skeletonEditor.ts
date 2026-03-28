import type { Bone } from "./types";

/**
 * The RETARGET_TREE bone order (parent before child, so traversal works top-down).
 * This MUST match the order in monsees_retarget/retarget_proportions.py.
 */
export const RETARGET_TREE: Bone[] = [
  { parent: "SpineL", child: "SpineM" },
  { parent: "SpineM", child: "SpineF" },
  { parent: "SpineF", child: "Snout" },
  { parent: "SpineL", child: "TailBase" },
  { parent: "SpineF", child: "ShoulderL" },
  { parent: "SpineF", child: "ShoulderR" },
  { parent: "SpineL", child: "HipL" },
  { parent: "SpineL", child: "HipR" },
  { parent: "ShoulderL", child: "ElbowL" },
  { parent: "ElbowL", child: "WristL" },
  { parent: "WristL", child: "HandL" },
  { parent: "ShoulderR", child: "ElbowR" },
  { parent: "ElbowR", child: "WristR" },
  { parent: "WristR", child: "HandR" },
  { parent: "HipL", child: "KneeL" },
  { parent: "KneeL", child: "AnkleL" },
  { parent: "AnkleL", child: "FootL" },
  { parent: "HipR", child: "KneeR" },
  { parent: "KneeR", child: "AnkleR" },
  { parent: "AnkleR", child: "FootR" },
];

/** Spine/branching segments (the ones user typically wants to adjust) */
export const SPINE_SEGMENTS = new Set([
  "SpineL\u2192SpineM",
  "SpineM\u2192SpineF",
  "SpineF\u2192Snout",
  "SpineL\u2192TailBase",
  "SpineF\u2192ShoulderL",
  "SpineF\u2192ShoulderR",
  "SpineL\u2192HipL",
  "SpineL\u2192HipR",
]);

export function segmentKey(parent: string, child: string): string {
  return `${parent}\u2192${child}`;
}

/**
 * Adjust keypoint positions for one frame using per-segment scale factors.
 *
 * Root (SpineL) stays fixed. For each bone in tree order:
 *   child_new = parent_new + unit_direction * original_length * scale
 *
 * @param positions - (numKp, 3) flat array for one frame
 * @param numKp - number of keypoints
 * @param kpNames - keypoint name array
 * @param segmentScales - map of "parent\u2192child" to scale factor (default 1.0)
 * @returns new flat positions array for one frame
 */
export function adjustSkeletonFrame(
  positions: Float32Array | number[],
  numKp: number,
  kpNames: string[],
  segmentScales: Record<string, number>,
): Float32Array {
  const result = new Float32Array(numKp * 3);
  // Copy original positions
  for (let i = 0; i < numKp * 3; i++) result[i] = positions[i];

  const nameToIdx: Record<string, number> = {};
  kpNames.forEach((n, i) => {
    nameToIdx[n] = i;
  });

  for (const bone of RETARGET_TREE) {
    const pi = nameToIdx[bone.parent];
    const ci = nameToIdx[bone.child];
    if (pi === undefined || ci === undefined) continue;

    // Original direction from input positions
    const dx = positions[ci * 3 + 0] - positions[pi * 3 + 0];
    const dy = positions[ci * 3 + 1] - positions[pi * 3 + 1];
    const dz = positions[ci * 3 + 2] - positions[pi * 3 + 2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-8) continue;

    const scale = segmentScales[segmentKey(bone.parent, bone.child)] ?? 1.0;

    // Place child relative to (already adjusted) parent position
    result[ci * 3 + 0] = result[pi * 3 + 0] + (dx / len) * len * scale;
    result[ci * 3 + 1] = result[pi * 3 + 1] + (dy / len) * len * scale;
    result[ci * 3 + 2] = result[pi * 3 + 2] + (dz / len) * len * scale;
  }

  return result;
}

/**
 * Apply segment adjustments to all frames.
 * @param allPositions - flat (numFrames * numKp * 3) array
 * @param numFrames
 * @param numKp
 * @param kpNames
 * @param segmentScales
 * @returns new Float32Array with adjusted positions
 */
export function adjustAllFrames(
  allPositions: Float32Array,
  numFrames: number,
  numKp: number,
  kpNames: string[],
  segmentScales: Record<string, number>,
): Float32Array {
  const result = new Float32Array(numFrames * numKp * 3);
  const frameSize = numKp * 3;
  for (let f = 0; f < numFrames; f++) {
    const offset = f * frameSize;
    const frameIn = allPositions.subarray(offset, offset + frameSize);
    const frameOut = adjustSkeletonFrame(frameIn, numKp, kpNames, segmentScales);
    result.set(frameOut, offset);
  }
  return result;
}
