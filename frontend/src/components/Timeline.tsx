import React, { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import * as api from "../api";
import GapHeatmap from "./GapHeatmap";

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

  if (numFrames === 0) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", color: "#555" }}>
        Load ACM data to enable timeline
      </div>
    );
  }

  const step = Math.max(1, Math.floor(numFrames / 100));
  const dots = [];
  for (let i = 0; i < numFrames; i += step) {
    const status = frameStatuses[i] || "unlabeled";
    const color = status === "validated" ? "#00cc44" : status === "labeled" ? "#ffaa00" : "#333";
    dots.push(
      <div
        key={i}
        style={{ width: 6, height: 6, borderRadius: 3, background: color, cursor: "pointer" }}
        onClick={() => setCurrentFrame(i)}
      />
    );
  }

  const missingNow =
    presentCount !== null && acmNumKeypoints > 0 && presentCount < acmNumKeypoints;

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 4, minWidth: 0, padding: "6px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <button onClick={togglePlay} style={btnStyle}>{isPlaying ? "\u23f8" : "\u25b6"}</button>
        <input
          type="range" min={0} max={numFrames - 1} value={currentFrame}
          onChange={(e) => setCurrentFrame(Number(e.target.value))}
          style={{ flex: 1, minWidth: 60 }}
        />
        <span style={{ color: "#ccc", fontSize: 13, whiteSpace: "nowrap" }}>
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
        <button onClick={labelCurrentFrame} style={btnStyle}>Label</button>
        <button onClick={handleSuggestFrames} style={btnStyle}>Suggest</button>
        <button onClick={() => setShowGaps((v) => !v)} style={btnStyle}>
          {showGaps ? "Hide gaps" : "Show gaps"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 1, alignItems: "center", overflow: "hidden", minWidth: 0, flexShrink: 0 }}>
        {dots}
      </div>
      {showGaps && (
        <div style={{ overflowY: "auto", overflowX: "hidden", maxHeight: 320, minWidth: 0 }}>
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
