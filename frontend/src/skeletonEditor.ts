import type { Bone } from "./types";

/**
 * Rodent bone tree (parent before child, so traversal works top-down).
 */
const RODENT_TREE: Bone[] = [
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

const RODENT_PRIMARY = new Set([
  "SpineL→SpineM", "SpineM→SpineF", "SpineF→Snout", "SpineL→TailBase",
  "SpineF→ShoulderL", "SpineF→ShoulderR", "SpineL→HipL", "SpineL→HipR",
]);

/**
 * Stick bug (sungaya inexpectata) bone tree.
 */
const STICK_TREE: Bone[] = [
  // Body chain
  { parent: "mouth", child: "head" },
  { parent: "head", child: "head_t1" },
  { parent: "head_t1", child: "t1_t2" },
  { parent: "t1_t2", child: "t2_t3" },
  { parent: "t2_t3", child: "t3_a1" },
  { parent: "t3_a1", child: "a2_a3" },
  { parent: "a2_a3", child: "a4_a5" },
  { parent: "a4_a5", child: "a6_a7" },
  { parent: "a6_a7", child: "a8_end" },
  // Antennae
  { parent: "head", child: "r_antenna_base" },
  { parent: "r_antenna_base", child: "r_antenna_tip" },
  { parent: "head", child: "l_antenna_base" },
  { parent: "l_antenna_base", child: "l_antenna_tip" },
  // Front left leg
  { parent: "head_t1", child: "f_l_coxa" },
  { parent: "f_l_coxa", child: "f_l_trochanter" },
  { parent: "f_l_trochanter", child: "f_l_femur" },
  { parent: "f_l_femur", child: "f_l_tibia" },
  { parent: "f_l_tibia", child: "f_l_tarsus" },
  { parent: "f_l_tarsus", child: "f_l_claws" },
  // Front right leg
  { parent: "head_t1", child: "f_r_coxa" },
  { parent: "f_r_coxa", child: "f_r_trochanter" },
  { parent: "f_r_trochanter", child: "f_r_femur" },
  { parent: "f_r_femur", child: "f_r_tibia" },
  { parent: "f_r_tibia", child: "f_r_tarsus" },
  { parent: "f_r_tarsus", child: "f_r_claws" },
  // Mid left leg
  { parent: "t2_t3", child: "m_l_coxa" },
  { parent: "m_l_coxa", child: "m_l_trochanter" },
  { parent: "m_l_trochanter", child: "m_l_femur" },
  { parent: "m_l_femur", child: "m_l_tibia" },
  { parent: "m_l_tibia", child: "m_l_tarsus" },
  { parent: "m_l_tarsus", child: "m_l_claws" },
  // Mid right leg
  { parent: "t2_t3", child: "m_r_coxa" },
  { parent: "m_r_coxa", child: "m_r_trochanter" },
  { parent: "m_r_trochanter", child: "m_r_femur" },
  { parent: "m_r_femur", child: "m_r_tibia" },
  { parent: "m_r_tibia", child: "m_r_tarsus" },
  { parent: "m_r_tarsus", child: "m_r_claws" },
  // Hind left leg
  { parent: "t3_a1", child: "h_l_coxa" },
  { parent: "h_l_coxa", child: "h_l_trochanter" },
  { parent: "h_l_trochanter", child: "h_l_femur" },
  { parent: "h_l_femur", child: "h_l_tibia" },
  { parent: "h_l_tibia", child: "h_l_tarsus" },
  { parent: "h_l_tarsus", child: "h_l_claws" },
  // Hind right leg
  { parent: "t3_a1", child: "h_r_coxa" },
  { parent: "h_r_coxa", child: "h_r_trochanter" },
  { parent: "h_r_trochanter", child: "h_r_femur" },
  { parent: "h_r_femur", child: "h_r_tibia" },
  { parent: "h_r_tibia", child: "h_r_tarsus" },
  { parent: "h_r_tarsus", child: "h_r_claws" },
];

const STICK_PRIMARY = new Set([
  // Body chain
  "mouth→head", "head→head_t1", "head_t1→t1_t2", "t1_t2→t2_t3",
  "t2_t3→t3_a1", "t3_a1→a2_a3", "a2_a3→a4_a5", "a4_a5→a6_a7", "a6_a7→a8_end",
  // Leg attachment points
  "head_t1→f_l_coxa", "head_t1→f_r_coxa",
  "t2_t3→m_l_coxa", "t2_t3→m_r_coxa",
  "t3_a1→h_l_coxa", "t3_a1→h_r_coxa",
]);

/**
 * Detect which walker's bone tree to use based on keypoint names.
 */
export function getRetargetTree(kpNames: string[]): Bone[] {
  const nameSet = new Set(kpNames);
  if (nameSet.has("mouth") && nameSet.has("f_l_coxa")) return STICK_TREE;
  if (nameSet.has("SpineL") && nameSet.has("SpineM")) return RODENT_TREE;
  // Fallback: return whichever tree has more matching keypoints
  const rodentMatch = RODENT_TREE.filter(b => nameSet.has(b.parent) && nameSet.has(b.child)).length;
  const stickMatch = STICK_TREE.filter(b => nameSet.has(b.parent) && nameSet.has(b.child)).length;
  return stickMatch > rodentMatch ? STICK_TREE : RODENT_TREE;
}

export function getPrimarySegments(kpNames: string[]): Set<string> {
  const nameSet = new Set(kpNames);
  if (nameSet.has("mouth") && nameSet.has("f_l_coxa")) return STICK_PRIMARY;
  if (nameSet.has("SpineL") && nameSet.has("SpineM")) return RODENT_PRIMARY;
  const rodentMatch = RODENT_TREE.filter(b => nameSet.has(b.parent) && nameSet.has(b.child)).length;
  const stickMatch = STICK_TREE.filter(b => nameSet.has(b.parent) && nameSet.has(b.child)).length;
  return stickMatch > rodentMatch ? STICK_PRIMARY : RODENT_PRIMARY;
}

/** Backwards-compatible exports — used by callers that don't pass kpNames */
export const RETARGET_TREE = RODENT_TREE;
export const PRIMARY_SEGMENTS = RODENT_PRIMARY;

export function segmentKey(parent: string, child: string): string {
  return `${parent}\u2192${child}`;
}

/**
 * Adjust keypoint positions for one frame using per-segment scale factors.
 *
 * Root stays fixed. For each bone in tree order:
 *   child_new = parent_new + unit_direction * original_length * scale
 */
export function adjustSkeletonFrame(
  positions: Float32Array | number[],
  numKp: number,
  kpNames: string[],
  segmentScales: Record<string, number>,
): Float32Array {
  const tree = getRetargetTree(kpNames);
  const result = new Float32Array(numKp * 3);
  for (let i = 0; i < numKp * 3; i++) result[i] = positions[i];

  const nameToIdx: Record<string, number> = {};
  kpNames.forEach((n, i) => {
    nameToIdx[n] = i;
  });

  for (const bone of tree) {
    const pi = nameToIdx[bone.parent];
    const ci = nameToIdx[bone.child];
    if (pi === undefined || ci === undefined) continue;

    const dx = positions[ci * 3 + 0] - positions[pi * 3 + 0];
    const dy = positions[ci * 3 + 1] - positions[pi * 3 + 1];
    const dz = positions[ci * 3 + 2] - positions[pi * 3 + 2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-8) continue;

    const scale = segmentScales[segmentKey(bone.parent, bone.child)] ?? 1.0;

    result[ci * 3 + 0] = result[pi * 3 + 0] + (dx / len) * len * scale;
    result[ci * 3 + 1] = result[pi * 3 + 1] + (dy / len) * len * scale;
    result[ci * 3 + 2] = result[pi * 3 + 2] + (dz / len) * len * scale;
  }

  return result;
}

/**
 * Apply segment adjustments to all frames.
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
