// Shared error → color thresholds. Used by ErrorLines (segment color) and
// ACMSkeleton (keypoint marker color) so the two visualisations agree.
export function errorToColor(errorMm: number): string {
  if (errorMm < 5) return "#00ff44";
  if (errorMm < 10) return "#88ff00";
  if (errorMm < 20) return "#ffaa00";
  if (errorMm < 40) return "#ff4400";
  return "#ff0000";
}
