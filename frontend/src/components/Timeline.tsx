import React, { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import * as api from "../api";
import GapHeatmap from "./GapHeatmap";

// Must match the LABEL_WIDTH constant in GapHeatmap so the slider, dot row,
// and heatmap plot area all share the same horizontal coordinate range.
const LABEL_WIDTH = 64;

export default function Timeline() {
  const currentFrame = useStore((s) => s.currentFrame);
  const numFrames = useStore((s) => s.acmNumFrames);
  const isPlaying = useStore((s) => s.isPlaying);
  const frameStatuses = useStore((s) => s.frameStatuses);
  const setCurrentFrame = useStore((s) => s.setCurrentFrame);
  const togglePlay = useStore((s) => s.togglePlay);
  const labelCurrentFrame = useStore((s) => s.labelCurrentFrame);
  const acmPositions = useStore((s) => s.acmPositions);
  const acmNumKeypoints = useStore((s) => s.acmNumKeypoints);
  const stacFrameIndices = useStore((s) => s.stacFrameIndices);
  const stacBodyTransforms = useStore((s) => s.stacBodyTransforms);
  const stacQpos = useStore((s) => s.stacQpos);
  const setBodyTransforms = useStore((s) => s.setBodyTransforms);
  const rawTemplate = useStore((s) => s.rawTemplate);
  const [showGaps, setShowGaps] = useState(true);

  // Count of keypoints present (non-NaN) in the current frame.
  const presentCount = useMemo(() => {
    if (!acmPositions || acmNumKeypoints === 0) return null;
    const base = currentFrame * acmNumKeypoints * 3;
    let n = 0;
    for (let k = 0; k < acmNumKeypoints; k++) {
      const i = base + k * 3;
      if (
        !Number.isNaN(acmPositions[i]) &&
        !Number.isNaN(acmPositions[i + 1]) &&
        !Number.isNaN(acmPositions[i + 2])
      ) n++;
    }
    return n;
  }, [acmPositions, currentFrame, acmNumKeypoints]);

  // When current frame changes and we have STAC results, update body transforms
  useEffect(() => {
    if (!stacFrameIndices || !stacBodyTransforms) return;
    const stacIdx = stacFrameIndices.indexOf(currentFrame);
    if (stacIdx >= 0 && stacIdx < stacBodyTransforms.length) {
      setBodyTransforms(stacBodyTransforms[stacIdx]);
    } else if (stacQpos && stacQpos.length > 0) {
      // Find nearest labeled frame and use its transforms
      let nearest = 0;
      let minDist = Infinity;
      for (let i = 0; i < stacFrameIndices.length; i++) {
        const dist = Math.abs(stacFrameIndices[i] - currentFrame);
        if (dist < minDist) {
          minDist = dist;
          nearest = i;
        }
      }
      if (nearest < stacBodyTransforms.length) {
        setBodyTransforms(stacBodyTransforms[nearest]);
      }
    }
  }, [currentFrame, stacFrameIndices, stacBodyTransforms, stacQpos, setBodyTransforms]);

  const animRef = useRef<number>(0);
  useEffect(() => {
    if (!isPlaying || numFrames === 0) return;
    const fps = 30;
    const interval = 1000 / fps;
    let lastTime = 0;
    const step = (time: number) => {
      if (time - lastTime >= interval) {
        lastTime = time;
        setCurrentFrame((useStore.getState().currentFrame + 1) % numFrames);
      }
      animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animRef.current);
  }, [isPlaying, numFrames, setCurrentFrame]);

  const handleSuggestFrames = async () => {
    if (!acmPositions || numFrames === 0) return;
    const result = await api.suggestFrames({
      positions: Array.from(acmPositions),
      numFrames: numFrames,
      numKeypoints: acmNumKeypoints,
      nSuggestions: 8,
    });
    if (result.frames) {
      for (const f of result.frames) {
        setCurrentFrame(f);
        labelCurrentFrame();
      }
      setCurrentFrame(result.frames[0]);
      alert("Suggested " + result.frames.length + " diverse frames");
    }
  };

  // Faint vertical ticks at every STAC clip boundary, so the clip cadence is
  // visible while scrubbing (handy for spotting clip-edge artifacts). Mirrors
  // the heatmap ticks; same colour for visual continuity.
  const clipTicks = useMemo(() => {
    const stac = rawTemplate?.stac as Record<string, unknown> | undefined;
    const raw = stac?.n_frames_per_clip;
    const clipSize = typeof raw === "number" && raw > 0 ? raw : 100;
    if (numFrames < 2 || clipSize >= numFrames) return null;
    const out: React.ReactElement[] = [];
    for (let f = clipSize; f < numFrames; f += clipSize) {
      const left = (f / (numFrames - 1)) * 100;
      out.push(
        <div
          key={f}
          style={{
            position: "absolute",
            left: `${left}%`,
            top: 0,
            bottom: 0,
            width: 1,
            background: "rgba(255,255,255,0.10)",
            pointerEvents: "none",
          }}
        />,
      );
    }
    return out;
  }, [rawTemplate, numFrames]);

  // Status dots \u2014 one marker per labeled/validated frame, positioned by frame
  // index so they line up with the slider and heatmap cursor. Up to ~100 dots
  // shown so the row stays readable on long timelines. Computed before the
  // early return below so the hook order stays stable.
  const dots = useMemo(() => {
    const step = Math.max(1, Math.floor(numFrames / 100));
    const out: React.ReactElement[] = [];
    for (let i = 0; i < numFrames; i += step) {
      const status = frameStatuses[i] || "unlabeled";
      if (status === "unlabeled") continue;
      const color = status === "validated" ? "#00cc44" : "#ffaa00";
      const left = numFrames > 1 ? (i / (numFrames - 1)) * 100 : 0;
      out.push(
        <div
          key={i}
          onClick={() => setCurrentFrame(i)}
          style={{
            position: "absolute",
            left: `calc(${left}% - 3px)`,
            top: 1,
            width: 6,
            height: 6,
            borderRadius: 3,
            background: color,
            cursor: "pointer",
          }}
        />
      );
    }
    return out;
  }, [frameStatuses, numFrames, setCurrentFrame]);

  if (numFrames === 0) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", color: "#555" }}>
        Load ACM data to enable timeline
      </div>
    );
  }

  const missingNow =
    presentCount !== null && acmNumKeypoints > 0 && presentCount < acmNumKeypoints;

  return (
    <div
      style={{
        width: "100%",
        display: "grid",
        gridTemplateColumns: `${LABEL_WIDTH}px 1fr`,
        rowGap: 4,
        columnGap: 0,
        minWidth: 0,
        padding: "6px 0",
        alignItems: "center",
      }}
    >
      {/* Header row \u2014 metadata + action buttons, spans both columns. */}
      <div
        style={{
          gridColumn: "1 / -1",
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
        }}
      >
        <span style={{ color: "#ccc", fontSize: 13, whiteSpace: "nowrap", fontFamily: "monospace" }}>
          {currentFrame} / {numFrames - 1}
        </span>
        {presentCount !== null && (
          <span
            style={{
              color: missingNow ? "#e88" : "#8c8",
              fontSize: 12,
              fontFamily: "monospace",
              whiteSpace: "nowrap",
            }}
            title="Keypoints present (non-NaN) in this frame"
          >
            {presentCount}/{acmNumKeypoints} kp
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button onClick={labelCurrentFrame} style={btnStyle}>Label</button>
        <button onClick={handleSuggestFrames} style={btnStyle}>Suggest</button>
        <button onClick={() => setShowGaps((v) => !v)} style={btnStyle}>
          {showGaps ? "Hide gaps" : "Show gaps"}
        </button>
      </div>

      {/* Scrubber row \u2014 play button in label col, slider in plot col. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <button onClick={togglePlay} style={btnStyle}>{isPlaying ? "\u23f8" : "\u25b6"}</button>
      </div>
      <input
        type="range"
        min={0}
        max={numFrames - 1}
        value={currentFrame}
        onChange={(e) => setCurrentFrame(Number(e.target.value))}
        style={{ width: "100%", margin: 0, display: "block" }}
      />

      {/* Status dot row \u2014 empty label col, dots in plot col positioned by % */}
      <div />
      <div style={{ position: "relative", height: 8, minWidth: 0 }}>
        {clipTicks}
        {dots}
      </div>

      {/* Heatmap \u2014 spans both columns; it carries its own LABEL_WIDTH-wide
          label column internally that lines up with col 1 here. */}
      {showGaps && (
        <div
          style={{
            gridColumn: "1 / -1",
            overflowY: "auto",
            overflowX: "hidden",
            maxHeight: 320,
            minWidth: 0,
          }}
        >
          <GapHeatmap />
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "#2a2a4a", border: "1px solid #444", color: "#ccc",
  padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 13,
};
