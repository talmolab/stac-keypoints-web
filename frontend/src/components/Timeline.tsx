import React, { useEffect, useRef } from "react";
import { useStore } from "../store";
import * as api from "../api";

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

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 4, justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={togglePlay} style={btnStyle}>{isPlaying ? "⏸" : "▶"}</button>
        <input
          type="range" min={0} max={numFrames - 1} value={currentFrame}
          onChange={(e) => setCurrentFrame(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={{ color: "#ccc", fontSize: 13, minWidth: 80, textAlign: "right" }}>
          {currentFrame} / {numFrames - 1}
        </span>
        <button onClick={labelCurrentFrame} style={btnStyle}>Label Frame</button>
        <button onClick={handleSuggestFrames} style={btnStyle}>Suggest Frames</button>
      </div>
      <div style={{ display: "flex", gap: 1, alignItems: "center", overflow: "hidden" }}>
        {dots}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "#2a2a4a", border: "1px solid #444", color: "#ccc",
  padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 13,
};
