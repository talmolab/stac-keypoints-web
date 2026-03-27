import React, { useEffect, useRef } from "react";
import { useStore } from "../store";

export default function Timeline() {
  const currentFrame = useStore((s) => s.currentFrame);
  const numFrames = useStore((s) => s.acmNumFrames);
  const isPlaying = useStore((s) => s.isPlaying);
  const frameStatuses = useStore((s) => s.frameStatuses);
  const setCurrentFrame = useStore((s) => s.setCurrentFrame);
  const togglePlay = useStore((s) => s.togglePlay);
  const labelCurrentFrame = useStore((s) => s.labelCurrentFrame);

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
