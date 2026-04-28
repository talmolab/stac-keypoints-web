// Shared Procrustes alignment runner. Used by:
//   - App.tsx autoload path (initial alignment when defaults are loaded)
//   - Toolbar's "Align" button
//   - useAutoAlign hook (re-align when keypoints are loaded after a config)
import { useStore } from "./store";
import * as api from "./api";

export interface AlignOutcome {
  ok: boolean;
  method?: string;
  scale?: number;
  error?: string;
}

/** Run Procrustes alignment on the current store state. Returns the outcome. */
export async function runAlignment(): Promise<AlignOutcome> {
  const state = useStore.getState();
  if (!state.acmPositions || !state.xmlPath || state.mappings.length === 0) {
    return { ok: false, error: "Need XML, keypoints, and mappings." };
  }
  const pairs: Record<string, string> = {};
  for (const m of state.mappings) pairs[m.keypointName] = m.bodyName;

  const result = await api.alignToMujoco({
    positions: Array.from(state.acmPositions),
    numFrames: state.acmNumFrames,
    numKeypoints: state.acmNumKeypoints,
    keypointNames: state.acmKeypointNames,
    xmlPath: state.xmlPath,
    keypointModelPairs: pairs,
    scaleFactor: state.scaleFactor,
    mocapScaleFactor: state.mocapScaleFactor,
  });
  if (result.error) return { ok: false, error: result.error };

  state.setAlignedPositions(result.alignedPositions);
  return { ok: true, method: result.method, scale: result.scale };
}

/** Format an outcome as a one-line status string. */
export function formatAlignStatus(outcome: AlignOutcome): string {
  if (!outcome.ok) return "Align failed: " + (outcome.error ?? "unknown");
  const scale = outcome.scale !== undefined ? `${outcome.scale.toFixed(3)}×` : "?";
  const method = outcome.method ?? "procrustes";
  // bbox is the fallback path when Procrustes returns an unreasonable scale —
  // worth flagging because the user probably has bad mappings.
  const tag = method === "bbox" ? "bbox fallback" : "procrustes";
  return `Aligned (${tag}, ${scale})`;
}
