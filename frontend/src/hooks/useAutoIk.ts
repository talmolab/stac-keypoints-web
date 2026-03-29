/**
 * Auto-IK hook: watches for changes to offsets, segment scales, mappings,
 * and current frame. When autoIk is enabled, debounces and runs IK
 * on the current frame automatically.
 */
import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { runIk } from "../ikRunner";

export function useAutoIk() {
  const autoIk = useStore((s) => s.autoIk);
  const currentFrame = useStore((s) => s.currentFrame);
  const offsets = useStore((s) => s.offsets);
  const segmentScales = useStore((s) => s.segmentScales);
  const mappings = useStore((s) => s.mappings);
  const xmlPath = useStore((s) => s.xmlPath);
  const acmPositions = useStore((s) => s.acmPositions);
  const modelScale = useStore((s) => s.modelScale);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);

  // Build a dependency fingerprint that changes when IK-relevant state changes
  const offsetFingerprint = offsets
    .map((o) => `${o.keypointName}:${o.x.toFixed(4)},${o.y.toFixed(4)},${o.z.toFixed(4)}`)
    .join("|");
  const scaleFingerprint = Object.entries(segmentScales)
    .map(([k, v]) => `${k}:${v.toFixed(3)}`)
    .join("|");
  const mappingFingerprint = mappings
    .map((m) => `${m.keypointName}:${m.bodyName}`)
    .join("|");

  useEffect(() => {
    if (!autoIk || !xmlPath || !acmPositions) return;

    // Clear any pending timer
    if (timerRef.current) clearTimeout(timerRef.current);

    // Debounce: 150ms for snappy feedback
    timerRef.current = setTimeout(async () => {
      if (runningRef.current) return; // skip if already running
      runningRef.current = true;
      const state = useStore.getState();
      state.setIkStatus("Auto IK...");
      // 25 iterations for live feedback (~0.2s per frame)
      await runIk([state.currentFrame], 25);
      runningRef.current = false;
    }, 150);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [
    autoIk,
    currentFrame,
    offsetFingerprint,
    scaleFingerprint,
    mappingFingerprint,
    xmlPath,
    acmPositions,
    modelScale,
  ]);
}
