import React from "react";
import Viewport3D from "./components/Viewport3D";

export default function App() {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 48, background: "#1a1a2e", display: "flex", alignItems: "center", padding: "0 16px", color: "#fff", gap: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 16 }}>STAC Retarget UI</span>
      </div>
      <div style={{ flex: 1, display: "flex" }}>
        <div style={{ flex: 3 }}>
          <Viewport3D />
        </div>
        <div style={{ width: 240, borderLeft: "1px solid #333", padding: 12, color: "#ccc", background: "#16213e" }}>
          Mapping Table
        </div>
        <div style={{ width: 280, borderLeft: "1px solid #333", padding: 12, color: "#ccc", background: "#16213e" }}>
          Properties
        </div>
      </div>
      <div style={{ height: 64, background: "#1a1a2e", borderTop: "1px solid #333", display: "flex", alignItems: "center", padding: "0 16px", color: "#888" }}>
        Timeline
      </div>
    </div>
  );
}
