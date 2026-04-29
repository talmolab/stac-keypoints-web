import React, { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";

const ROW_HEIGHT = 10;       // px per keypoint row
const CONF_ROW_HEIGHT = 16;  // px for the min-confidence header row
const LABEL_WIDTH = 64;      // px reserved for keypoint names
const PRESENT_COLOR = [42, 90, 58];   // muted green
const MISSING_COLOR = [80, 24, 24];   // dark red

// Confidence range mapped to the red→green gradient. Most trackers spend
// nearly all their time above 0.9, so [0, 1] makes the row look uniformly
// green; [0.4, 1.0] gives the dips visible contrast.
const CONF_RED_AT = 0.4;
const CONF_GREEN_AT = 1.0;

// Per-keypoint bitmask of which frames are missing. Built once per dataset
// load, then drawn at any width by bucketing frames into pixels.
function computeMissingMask(
  positions: Float32Array,
  numFrames: number,
  numKeypoints: number,
): Uint8Array {
  const mask = new Uint8Array(numKeypoints * numFrames);
  for (let f = 0; f < numFrames; f++) {
    for (let k = 0; k < numKeypoints; k++) {
      const base = (f * numKeypoints + k) * 3;
      const missing =
        Number.isNaN(positions[base]) ||
        Number.isNaN(positions[base + 1]) ||
        Number.isNaN(positions[base + 2]);
      if (missing) mask[k * numFrames + f] = 1;
    }
  }
  return mask;
}

function clipFramesPerClip(rawTemplate: Record<string, unknown> | null): number {
  const stac = rawTemplate?.stac as Record<string, unknown> | undefined;
  const n = stac?.n_frames_per_clip;
  return typeof n === "number" && n > 0 ? n : 100;
}

export default function GapHeatmap() {
  const acmPositions = useStore((s) => s.acmPositions);
  const acmConfidences = useStore((s) => s.acmConfidences);
  const numFrames = useStore((s) => s.acmNumFrames);
  const numKeypoints = useStore((s) => s.acmNumKeypoints);
  const keypointNames = useStore((s) => s.acmKeypointNames);
  const currentFrame = useStore((s) => s.currentFrame);
  const setCurrentFrame = useStore((s) => s.setCurrentFrame);
  const rawTemplate = useStore((s) => s.rawTemplate);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<{ x: number; y: number; frame: number; kp: string } | null>(null);

  const mask = useMemo(() => {
    if (!acmPositions || numFrames === 0 || numKeypoints === 0) return null;
    return computeMissingMask(acmPositions, numFrames, numKeypoints);
  }, [acmPositions, numFrames, numKeypoints]);

  // Per-frame min confidence over present keypoints. NaN when no keypoint
  // is present in that frame. null when the dataset has no confidences.
  // We use min rather than mean: trackers spend most of their time near
  // 1.0 on healthy keypoints, so the mean drowns out a single low-conf
  // keypoint. Min surfaces any frame where *any* keypoint is unreliable —
  // which is what researchers actually want to spot.
  const minConfPerFrame = useMemo(() => {
    if (!acmConfidences || numFrames === 0 || numKeypoints === 0) return null;
    const out = new Float32Array(numFrames);
    for (let f = 0; f < numFrames; f++) {
      let m = Infinity;
      for (let k = 0; k < numKeypoints; k++) {
        const c = acmConfidences[f * numKeypoints + k];
        if (Number.isFinite(c) && c < m) m = c;
      }
      out[f] = Number.isFinite(m) ? m : NaN;
    }
    return out;
  }, [acmConfidences, numFrames, numKeypoints]);

  // Per-keypoint missing % for the row labels.
  const missingPct = useMemo(() => {
    if (!mask) return [];
    const out: number[] = [];
    for (let k = 0; k < numKeypoints; k++) {
      let n = 0;
      for (let f = 0; f < numFrames; f++) n += mask[k * numFrames + f];
      out.push(numFrames > 0 ? n / numFrames : 0);
    }
    return out;
  }, [mask, numFrames, numKeypoints]);

  // Resize observer keeps the canvas matched to its container.
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const w = Math.max(200, Math.floor(entries[0].contentRect.width));
      setWidth(w);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const topOffset = minConfPerFrame ? CONF_ROW_HEIGHT : 0;

  // Paint the heatmap whenever data, width, or cursor changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mask || numFrames === 0 || numKeypoints === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const plotW = Math.max(1, width - LABEL_WIDTH);
    const plotH = topOffset + numKeypoints * ROW_HEIGHT;
    canvas.width = (LABEL_WIDTH + plotW) * dpr;
    canvas.height = plotH * dpr;
    canvas.style.height = `${plotH}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, LABEL_WIDTH + plotW, plotH);

    // Bucket frames into pixel columns. Each column's color is the missing
    // ratio across the frames it covers — interpolated between PRESENT and
    // MISSING. Pure ImageData manipulation for speed on long timelines.
    const img = ctx.createImageData(plotW, plotH);

    // Min-confidence header row. Color stretches over [CONF_RED_AT,
    // CONF_GREEN_AT] so dips into 0.5–0.7 territory read clearly orange,
    // not green-with-asterisk.
    if (minConfPerFrame) {
      const span = Math.max(1e-6, CONF_GREEN_AT - CONF_RED_AT);
      for (let x = 0; x < plotW; x++) {
        const fStart = Math.floor((x / plotW) * numFrames);
        const fEnd = Math.max(fStart + 1, Math.floor(((x + 1) / plotW) * numFrames));
        // Min over the bucket — sensitive to any low-conf frame in the range.
        let bucketMin = Infinity;
        for (let f = fStart; f < fEnd; f++) {
          const c = minConfPerFrame[f];
          if (Number.isFinite(c) && c < bucketMin) bucketMin = c;
        }
        let ratio: number;
        if (!Number.isFinite(bucketMin)) {
          ratio = 1;  // no data in bucket → red
        } else {
          const norm = Math.max(0, Math.min(1, (bucketMin - CONF_RED_AT) / span));
          ratio = 1 - norm;  // 0 = high conf, 1 = low/none
        }
        const r = Math.round(PRESENT_COLOR[0] + ratio * (MISSING_COLOR[0] - PRESENT_COLOR[0]));
        const g = Math.round(PRESENT_COLOR[1] + ratio * (MISSING_COLOR[1] - PRESENT_COLOR[1]));
        const b = Math.round(PRESENT_COLOR[2] + ratio * (MISSING_COLOR[2] - PRESENT_COLOR[2]));
        for (let dy = 0; dy < CONF_ROW_HEIGHT; dy++) {
          const px = (dy * plotW + x) * 4;
          // Last row pixel = separator from the keypoint grid below.
          if (dy === CONF_ROW_HEIGHT - 1) {
            img.data[px] = 30;
            img.data[px + 1] = 30;
            img.data[px + 2] = 40;
          } else {
            img.data[px] = r;
            img.data[px + 1] = g;
            img.data[px + 2] = b;
          }
          img.data[px + 3] = 255;
        }
      }
    }

    for (let k = 0; k < numKeypoints; k++) {
      for (let x = 0; x < plotW; x++) {
        const fStart = Math.floor((x / plotW) * numFrames);
        const fEnd = Math.max(fStart + 1, Math.floor(((x + 1) / plotW) * numFrames));
        let miss = 0;
        const span = fEnd - fStart;
        for (let f = fStart; f < fEnd; f++) miss += mask[k * numFrames + f];
        const ratio = miss / span;
        const r = Math.round(PRESENT_COLOR[0] + ratio * (MISSING_COLOR[0] - PRESENT_COLOR[0]));
        const g = Math.round(PRESENT_COLOR[1] + ratio * (MISSING_COLOR[1] - PRESENT_COLOR[1]));
        const b = Math.round(PRESENT_COLOR[2] + ratio * (MISSING_COLOR[2] - PRESENT_COLOR[2]));
        for (let dy = 0; dy < ROW_HEIGHT; dy++) {
          const y = topOffset + k * ROW_HEIGHT + dy;
          // Leave a 1px gap between rows for legibility.
          if (dy === ROW_HEIGHT - 1 && ROW_HEIGHT > 2) {
            const px = (y * plotW + x) * 4;
            img.data[px] = 20;
            img.data[px + 1] = 20;
            img.data[px + 2] = 30;
            img.data[px + 3] = 255;
            continue;
          }
          const px = (y * plotW + x) * 4;
          img.data[px] = r;
          img.data[px + 1] = g;
          img.data[px + 2] = b;
          img.data[px + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, LABEL_WIDTH, 0);

    // Clip boundaries — light vertical ticks at every n_frames_per_clip.
    const clipSize = clipFramesPerClip(rawTemplate);
    if (clipSize > 0 && clipSize < numFrames) {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      for (let f = clipSize; f < numFrames; f += clipSize) {
        const x = LABEL_WIDTH + Math.floor((f / numFrames) * plotW);
        ctx.fillRect(x, 0, 1, plotH);
      }
    }

    // Cursor line for current frame.
    if (numFrames > 1) {
      const cx = LABEL_WIDTH + Math.floor((currentFrame / (numFrames - 1)) * (plotW - 1));
      ctx.fillStyle = "rgba(255, 220, 80, 0.95)";
      ctx.fillRect(cx, 0, 1, plotH);
    }
  }, [mask, minConfPerFrame, numFrames, numKeypoints, width, currentFrame, rawTemplate, topOffset]);

  if (!mask || numFrames === 0 || numKeypoints === 0) return null;

  const plotW = Math.max(1, width - LABEL_WIDTH);

  const xToFrame = (clientX: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left - LABEL_WIDTH;
    if (x < 0) return null;
    const frame = Math.floor((x / plotW) * numFrames);
    return Math.max(0, Math.min(numFrames - 1, frame));
  };

  // Returns:
  //   -1 = hovering the mean-confidence header row
  //   k ∈ [0, numKeypoints) = a per-keypoint row
  //   null = outside the plot
  const yToRow = (clientY: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const y = clientY - rect.top;
    if (y < 0) return null;
    if (minConfPerFrame && y < CONF_ROW_HEIGHT) return -1;
    const k = Math.floor((y - topOffset) / ROW_HEIGHT);
    if (k < 0 || k >= numKeypoints) return null;
    return k;
  };

  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const f = xToFrame(e.clientX);
    const row = yToRow(e.clientY);
    if (f === null || row === null) {
      setHover(null);
      return;
    }
    let label: string;
    if (row === -1) {
      const c = minConfPerFrame ? minConfPerFrame[f] : NaN;
      label = Number.isFinite(c)
        ? `min conf: ${c.toFixed(2)}`
        : "min conf: —";
    } else {
      const name = keypointNames[row] || `kp_${row}`;
      const isMissing = mask && mask[row * numFrames + f] === 1;
      const conf = acmConfidences ? acmConfidences[f * numKeypoints + row] : NaN;
      const confStr = Number.isFinite(conf) ? ` · conf ${conf.toFixed(2)}` : "";
      label = `${name}${isMissing ? " (missing)" : ""}${confStr}`;
    }
    setHover({ x: e.clientX, y: e.clientY, frame: f, kp: label });
    if (e.buttons === 1) setCurrentFrame(f);
  };

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      {/* Row labels — absolute-positioned divs aligned to canvas rows. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: LABEL_WIDTH,
          height: topOffset + numKeypoints * ROW_HEIGHT,
          fontSize: 9,
          color: "#888",
          pointerEvents: "none",
          fontFamily: "monospace",
          overflow: "hidden",
        }}
      >
        {minConfPerFrame && (
          <div
            style={{
              height: CONF_ROW_HEIGHT,
              lineHeight: `${CONF_ROW_HEIGHT}px`,
              paddingLeft: 4,
              color: "#aaa",
              fontWeight: 600,
            }}
            title="Min confidence across present keypoints, per frame"
          >
            min conf
          </div>
        )}
        {keypointNames.map((name, k) => {
          const pct = missingPct[k] || 0;
          const dim = pct > 0.5;
          return (
            <div
              key={k}
              style={{
                height: ROW_HEIGHT,
                lineHeight: `${ROW_HEIGHT}px`,
                paddingLeft: 4,
                color: dim ? "#c66" : "#888",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={`${name}: ${(pct * 100).toFixed(1)}% missing`}
            >
              {name}
            </div>
          );
        })}
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", display: "block", cursor: "crosshair" }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        onMouseDown={(e) => {
          const f = xToFrame(e.clientX);
          if (f !== null) setCurrentFrame(f);
        }}
      />
      {hover && (
        <div
          style={{
            position: "fixed",
            left: hover.x + 12,
            top: hover.y - 28,
            background: "#000c",
            color: "#fff",
            fontSize: 11,
            padding: "2px 6px",
            borderRadius: 3,
            pointerEvents: "none",
            zIndex: 100,
            fontFamily: "monospace",
          }}
        >
          {hover.kp} @ frame {hover.frame}
        </div>
      )}
    </div>
  );
}
