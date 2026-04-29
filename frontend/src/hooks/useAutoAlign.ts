// Re-run Procrustes alignment whenever fresh keypoints arrive while
// mappings are already in place — covers the case where the user loads
// a config first and then loads keypoints (or vice-versa). The initial
// autoload path also benefits, but it already calls runAlignment() once;
// this hook adds the missing follow-up triggers.
//
// `setAcmData` clears `isAligned`, so loading new ACM data unblocks the
// effect; `setAlignedPositions` sets it back to true and re-blocks.
import { useEffect } from "react";
import { useStore } from "../store";
import { runAlignment, formatAlignStatus } from "../alignment";

export function useAutoAlign() {
  const acmPositions = useStore((s) => s.acmPositions);
  const xmlPath = useStore((s) => s.xmlPath);
  const mappingsLen = useStore((s) => s.mappings.length);
  const isAligned = useStore((s) => s.isAligned);
  const setIkStatus = useStore((s) => s.setIkStatus);

  useEffect(() => {
    if (!acmPositions || !xmlPath || mappingsLen === 0 || isAligned) return;
    let cancelled = false;
    (async () => {
      const outcome = await runAlignment();
      if (cancelled) return;
      setIkStatus(formatAlignStatus(outcome));
    })();
    return () => {
      cancelled = true;
    };
  }, [acmPositions, xmlPath, mappingsLen, isAligned, setIkStatus]);
}
