// Quality report export. Produces a single JSON document summarising:
//   - per-keypoint gap % (fraction of frames with NaN position)
//   - confidence histogram bins (10 buckets across [0, 1])
//   - per-keypoint Euclidean error (mm) at the current frame, copied from
//     the store's live `perKeypointErrors` array
//   - overall counts and a small dataset header
//
// Runs entirely from already-computed store state — no backend round trip.
// Saves through the same FSA-or-blob path as YAML config export.
import { useStore } from "./store";

interface PerKeypointStats {
  keypointName: string;
  gapPct: number;
  meanConfidence: number | null;
  errorMm: number | null;
}

interface QualityReport {
  generatedAt: string;
  dataset: {
    xmlBasename: string;
    numFrames: number;
    numKeypoints: number;
    currentFrame: number;
  };
  perKeypoint: PerKeypointStats[];
  confidenceHistogram: {
    binEdges: number[];
    counts: number[];
    totalSamples: number;
    nonNanSamples: number;
  } | null;
  summary: {
    meanGapPct: number;
    maxGapPct: number;
    keypointWithMaxGap: string | null;
    meanErrorMm: number | null;
    maxErrorMm: number | null;
    keypointWithMaxError: string | null;
  };
}

function computePerKeypointGap(
  positions: Float32Array,
  numFrames: number,
  numKp: number,
): Float64Array {
  const out = new Float64Array(numKp);
  for (let k = 0; k < numKp; k++) {
    let missing = 0;
    for (let f = 0; f < numFrames; f++) {
      const base = (f * numKp + k) * 3;
      if (
        Number.isNaN(positions[base]) ||
        Number.isNaN(positions[base + 1]) ||
        Number.isNaN(positions[base + 2])
      ) {
        missing++;
      }
    }
    out[k] = numFrames > 0 ? missing / numFrames : 0;
  }
  return out;
}

function computeMeanConfidence(
  confidences: Float32Array,
  numFrames: number,
  numKp: number,
): Float64Array {
  const out = new Float64Array(numKp);
  for (let k = 0; k < numKp; k++) {
    let sum = 0;
    let count = 0;
    for (let f = 0; f < numFrames; f++) {
      const v = confidences[f * numKp + k];
      if (!Number.isNaN(v)) {
        sum += v;
        count++;
      }
    }
    out[k] = count > 0 ? sum / count : NaN;
  }
  return out;
}

function computeConfidenceHistogram(confidences: Float32Array): {
  binEdges: number[];
  counts: number[];
  totalSamples: number;
  nonNanSamples: number;
} {
  const NBINS = 10;
  const counts = new Array(NBINS).fill(0);
  let nonNan = 0;
  for (let i = 0; i < confidences.length; i++) {
    const v = confidences[i];
    if (Number.isNaN(v)) continue;
    nonNan++;
    // Clamp to [0, 1] then bin. v == 1 lands in the last bin.
    const clamped = v < 0 ? 0 : v > 1 ? 1 : v;
    const bin = clamped >= 1 ? NBINS - 1 : Math.floor(clamped * NBINS);
    counts[bin]++;
  }
  const binEdges = new Array(NBINS + 1);
  for (let i = 0; i <= NBINS; i++) binEdges[i] = i / NBINS;
  return { binEdges, counts, totalSamples: confidences.length, nonNanSamples: nonNan };
}

export function buildQualityReport(): QualityReport {
  const s = useStore.getState();
  const names = s.acmKeypointNames;
  const numKp = names.length;
  const numFrames = s.acmNumFrames;

  const gap = s.acmPositions
    ? computePerKeypointGap(s.acmPositions, numFrames, numKp)
    : new Float64Array(numKp);
  const meanConf = s.acmConfidences
    ? computeMeanConfidence(s.acmConfidences, numFrames, numKp)
    : null;
  const errMap = new Map<string, number>();
  for (const e of s.perKeypointErrors) errMap.set(e.keypointName, e.errorMm);

  const perKeypoint: PerKeypointStats[] = names.map((n, k) => ({
    keypointName: n,
    gapPct: gap[k],
    meanConfidence: meanConf && !Number.isNaN(meanConf[k]) ? meanConf[k] : null,
    errorMm: errMap.has(n) ? errMap.get(n)! : null,
  }));

  let meanGap = 0;
  let maxGap = -Infinity;
  let kpMaxGap: string | null = null;
  for (const p of perKeypoint) {
    meanGap += p.gapPct;
    if (p.gapPct > maxGap) {
      maxGap = p.gapPct;
      kpMaxGap = p.keypointName;
    }
  }
  meanGap = perKeypoint.length > 0 ? meanGap / perKeypoint.length : 0;

  const errorsOnly = perKeypoint.filter((p) => p.errorMm !== null) as (PerKeypointStats & {
    errorMm: number;
  })[];
  let meanErr: number | null = null;
  let maxErr: number | null = null;
  let kpMaxErr: string | null = null;
  if (errorsOnly.length > 0) {
    let sum = 0;
    let m = -Infinity;
    for (const p of errorsOnly) {
      sum += p.errorMm;
      if (p.errorMm > m) {
        m = p.errorMm;
        kpMaxErr = p.keypointName;
      }
    }
    meanErr = sum / errorsOnly.length;
    maxErr = m;
  }

  return {
    generatedAt: new Date().toISOString(),
    dataset: {
      xmlBasename: s.xmlBasename || "(none)",
      numFrames,
      numKeypoints: numKp,
      currentFrame: s.currentFrame,
    },
    perKeypoint,
    confidenceHistogram: s.acmConfidences ? computeConfidenceHistogram(s.acmConfidences) : null,
    summary: {
      meanGapPct: meanGap,
      maxGapPct: maxGap === -Infinity ? 0 : maxGap,
      keypointWithMaxGap: kpMaxGap,
      meanErrorMm: meanErr,
      maxErrorMm: maxErr,
      keypointWithMaxError: kpMaxErr,
    },
  };
}

function downloadJson(body: string, filename: string) {
  const blob = new Blob([body], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface FSAFileHandle {
  name: string;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}
type ShowSaveFilePicker = (opts: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FSAFileHandle>;

/** Build a QualityReport from current store state and offer it as a download
 *  (or save-in-place via the FSA picker on Chrome/Edge). Updates the status
 *  banner. Returns true on success. */
export async function runQualityReportExport(): Promise<boolean> {
  const setIkStatus = useStore.getState().setIkStatus;
  const report = buildQualityReport();
  if (report.dataset.numKeypoints === 0) {
    setIkStatus("Quality report needs keypoint data — load a dataset first.");
    return false;
  }
  const body = JSON.stringify(report, null, 2);
  const filename = "stac_quality_report.json";

  if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
    try {
      const picker = (window as unknown as { showSaveFilePicker: ShowSaveFilePicker }).showSaveFilePicker;
      const handle = await picker({
        suggestedName: filename,
        types: [{ description: "JSON report", accept: { "application/json": [".json"] } }],
      });
      const w = await handle.createWritable();
      await w.write(body);
      await w.close();
      setIkStatus(`Quality report saved to ${handle.name}.`);
      return true;
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        setIkStatus("Save cancelled.");
        return false;
      }
      // Fall through to download.
    }
  }

  downloadJson(body, filename);
  setIkStatus("Quality report downloaded.");
  return true;
}
