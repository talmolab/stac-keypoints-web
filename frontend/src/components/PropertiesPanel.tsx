import React from "react";
import { useStore } from "../store";
import type { InteractionMode } from "../types";

export default function PropertiesPanel() {
  const selectedKp = useStore((s) => s.selectedKeypoint);
  const offsets = useStore((s) => s.offsets);
  const mappings = useStore((s) => s.mappings);
  const spineBlend = useStore((s) => s.spineBlend);
  const scaleFactor = useStore((s) => s.scaleFactor);
  const updateOffset = useStore((s) => s.updateOffset);
  const setSpineBlend = useStore((s) => s.setSpineBlend);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);

  const currentOffset = selectedKp ? offsets.find((o) => o.keypointName === selectedKp) : null;
  const currentMapping = selectedKp ? mappings.find((m) => m.keypointName === selectedKp) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
      <div>
        <h3 style={{ margin: "0 0 8px", fontSize: 14, color: "#aaa" }}>Mode</h3>
        <div style={{ display: "flex", gap: 4 }}>
          {(["mapping", "offset"] as InteractionMode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} style={{
              ...btnStyle,
              background: mode === m ? "#4444aa" : "#2a2a4a",
              fontWeight: mode === m ? 600 : 400,
            }}>
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {selectedKp && (
        <div>
          <h3 style={{ margin: "0 0 8px", fontSize: 14, color: "#aaa" }}>
            Selected: <span style={{ color: "#ffaa00" }}>{selectedKp}</span>
          </h3>
          {currentMapping && (
            <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
              Mapped to: <span style={{ color: "#66bbff" }}>{currentMapping.bodyName}</span>
            </div>
          )}
          {currentMapping && (
            <div>
              <div style={{ fontSize: 12, color: "#aaa", marginBottom: 4 }}>Offset (meters):</div>
              {(["x", "y", "z"] as const).map((axis) => (
                <div key={axis} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <label style={{ color: "#888", fontSize: 12, width: 12 }}>{axis.toUpperCase()}</label>
                  <input
                    type="number" step={0.001}
                    value={currentOffset?.[axis] ?? 0}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      const o = currentOffset || { x: 0, y: 0, z: 0 };
                      updateOffset(selectedKp,
                        axis === "x" ? val : o.x,
                        axis === "y" ? val : o.y,
                        axis === "z" ? val : o.z
                      );
                    }}
                    style={inputStyle}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: "auto" }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 14, color: "#aaa" }}>Parameters</h3>
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 12, color: "#888" }}>spine_blend: {spineBlend.toFixed(2)}</label>
          <input type="range" min={0} max={1} step={0.05} value={spineBlend}
            onChange={(e) => setSpineBlend(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ fontSize: 12, color: "#666" }}>Scale: {scaleFactor}</div>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "#2a2a4a", border: "1px solid #444", color: "#ccc",
  padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 12,
};
const inputStyle: React.CSSProperties = {
  background: "#1a1a2e", border: "1px solid #444", color: "#ccc",
  padding: "2px 6px", borderRadius: 3, width: 80, fontSize: 12,
};
