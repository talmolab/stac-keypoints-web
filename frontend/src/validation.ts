import type { KPMapping } from "./types";

export interface ValidationResult {
  /** Hard failures: exporting as-is will break stac-mjx. */
  errors: string[];
  /** Soft issues: user may have done this intentionally. */
  warnings: string[];
}

export interface ValidationInput {
  mappings: KPMapping[];
  bodyNames: string[];
  acmKeypointNames: string[];
}

/**
 * Check a set of mappings against the loaded model and dataset.
 *
 * Errors (block stac-mjx):
 *   - A mapping whose bodyName isn't in the model.
 *
 * Warnings (worth flagging but not blocking):
 *   - A keypoint in the dataset that isn't mapped.
 *   - A mapping for a keypoint that isn't in the currently loaded dataset
 *     (e.g. loaded from a template for a different subject).
 */
export function validateMappings(input: ValidationInput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const mappedKps = new Set(input.mappings.map((m) => m.keypointName));
  const bodySet = new Set(input.bodyNames);
  const kpSet = new Set(input.acmKeypointNames);

  for (const m of input.mappings) {
    if (input.bodyNames.length > 0 && !bodySet.has(m.bodyName)) {
      errors.push(`"${m.keypointName}" → "${m.bodyName}": body not in model`);
    }
  }

  for (const kp of input.acmKeypointNames) {
    if (!mappedKps.has(kp)) {
      warnings.push(`"${kp}": no mapping`);
    }
  }

  if (input.acmKeypointNames.length > 0) {
    for (const m of input.mappings) {
      if (!kpSet.has(m.keypointName)) {
        warnings.push(
          `"${m.keypointName}" → "${m.bodyName}": keypoint not in loaded dataset`,
        );
      }
    }
  }

  return { errors, warnings };
}
