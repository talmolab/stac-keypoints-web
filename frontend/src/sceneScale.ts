/**
 * Derived scene scale for sizing UI markers (keypoint dots, offset markers,
 * gizmo handles) so they look reasonable across species that span four
 * orders of magnitude (fly ~5mm, rat ~30cm, stick bug ~16cm).
 *
 * Centralised here so every marker component agrees on the same base radius,
 * and the user-facing `markerSize` multiplier in the store stacks cleanly
 * on top.
 */
import type { BodyTransform } from "./types";

/** Bounding-box diagonal of a set of body world positions (meters). */
export function bboxDiagonal(transforms: BodyTransform[]): number {
  if (transforms.length === 0) return 0;
  let xMin = Infinity, yMin = Infinity, zMin = Infinity;
  let xMax = -Infinity, yMax = -Infinity, zMax = -Infinity;
  for (const t of transforms) {
    const [x, y, z] = t.position;
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    if (z < zMin) zMin = z; if (z > zMax) zMax = z;
  }
  const dx = xMax - xMin, dy = yMax - yMin, dz = zMax - zMin;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Default marker radius derived from model bbox. Returns a sensible fallback
 * (~3mm — old hard-coded rat default) when bodyTransforms aren't ready.
 *
 * The 0.012 fraction was picked so:
 *   - Rat (~0.3m diag) → ~3.6mm
 *   - Stick bug (~0.16m diag) → ~1.9mm
 *   - Fly (~5mm diag) → ~0.06mm (user will want to bump markerSize for fly)
 *
 * `multiplier` is the user-facing knob (state.markerSize, default 1.0).
 */
export function markerRadius(
  transforms: BodyTransform[],
  multiplier: number = 1.0,
  fraction: number = 0.012,
): number {
  const diag = bboxDiagonal(transforms);
  if (diag <= 0) return 0.003 * multiplier;
  return diag * fraction * multiplier;
}
