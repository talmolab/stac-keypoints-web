import React, { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";

const ROW_HEIGHT = 6;        // px per keypoint row
const LABEL_WIDTH = 64;      // px reserved for keypoint names
const PRESENT_COLOR = [42, 90, 58];   // muted green
const MISSING_COLOR = [80, 24, 24];   // dark red

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

  // Paint the heatmap whenever data, width, or cursor changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mask || numFrames === 0 || numKeypoints === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const plotW = Math.max(1, width - LABEL_WIDTH);
    const plotH = numKeypoints * ROW_HEIGHT;
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
          const y = k * ROW_HEIGHT + dy;
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
  }, [mask, numFrames, numKeypoints, width, currentFrame, rawTemplate]);

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

  const yToKp = (clientY: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const y = clientY - rect.top;
    const k = Math.floor(y / ROW_HEIGHT);
    if (k < 0 || k >= numKeypoints) return null;
    return k;
  };

  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const f = xToFrame(e.clientX);
    const k = yToKp(e.clientY);
    if (f === null || k === null) {
      setHover(null);
      return;
    }
    setHover({
      x: e.clientX,
      y: e.clientY,
      frame: f,
      kp: keypointNames[k] || `kp_${k}`,
    });
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
          height: numKeypoints * ROW_HEIGHT,
          fontSize: 9,
          lineHeight: `${ROW_HEIGHT}px`,
          color: "#888",
          pointerEvents: "none",
          fontFamily: "monospace",
          overflow: "hidden",
        }}
      >
        {keypointNames.map((name, k) => {
          const pct = missingPct[k] || 0;
          const dim = pct > 0.5;
          return (
            <div
              key={k}
              style={{
                height: ROW_HEIGHT,
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
          {mask[
            keypointNames.indexOf(hover.kp) >= 0
              ? keypointNames.indexOf(hover.kp) * numFrames + hover.frame
              : 0
          ] === 1 && " (missing)"}
        </div>
      )}
    </div>
  );
}
