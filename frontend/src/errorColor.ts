// Shared error → color thresholds. Used by ErrorLines (segment color) and
// ACMSkeleton (keypoint marker color) so the two visualisations agree.
// Caller should hand us NaN for missing data — without this guard NaN would
// fall through every comparison (NaN < N is false) and be coloured red,
// which reads as "very high error" rather than "absent".
export function errorToColor(errorMm: number): string {
  if (Number.isNaN(errorMm)) return "#666";
  if (errorMm < 5) return "#00ff44";
  if (errorMm < 10) return "#88ff00";
  if (errorMm < 20) return "#ffaa00";
  if (errorMm < 40) return "#ff4400";
  return "#ff0000";
}
