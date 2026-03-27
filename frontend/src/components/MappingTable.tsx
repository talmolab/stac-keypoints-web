import React from "react";
import { useStore } from "../store";

export default function MappingTable() {
  const mappings = useStore((s) => s.mappings);
  const selectedKp = useStore((s) => s.selectedKeypoint);
  const removeMapping = useStore((s) => s.removeMapping);
  const mode = useStore((s) => s.mode);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 14, color: "#aaa" }}>Keypoint → Body</h3>
      {mode === "mapping" && (
        <div style={{ marginBottom: 8, fontSize: 12, color: "#888" }}>
          {selectedKp ? (
            <span>Selected: <strong style={{ color: "#ffaa00" }}>{selectedKp}</strong> → click a body</span>
          ) : "Click a keypoint to start mapping"}
        </div>
      )}
      <div style={{ flex: 1, overflow: "auto" }}>
        {mappings.length === 0 ? (
          <div style={{ color: "#555", fontSize: 12 }}>No mappings yet</div>
        ) : (
          mappings.map((m) => (
            <div key={m.keypointName} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "4px 0", borderBottom: "1px solid #2a2a4a", fontSize: 12,
            }}>
              <span>
                <span style={{ color: "#ffaa00" }}>{m.keypointName}</span>{" → "}
                <span style={{ color: "#66bbff" }}>{m.bodyName}</span>
              </span>
              <button onClick={() => removeMapping(m.keypointName)} style={{
                background: "none", border: "none", color: "#ff4444", cursor: "pointer", fontSize: 14,
              }}>×</button>
            </div>
          ))
        )}
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: "#555" }}>{mappings.length} / 21 mapped</div>
    </div>
  );
}
