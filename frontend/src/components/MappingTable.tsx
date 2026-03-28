import React, { useState, useMemo, useRef, useEffect } from "react";
import { useStore } from "../store";

export default function MappingTable() {
  const mappings = useStore((s) => s.mappings);
  const selectedKp = useStore((s) => s.selectedKeypoint);
  const removeMapping = useStore((s) => s.removeMapping);
  const addMapping = useStore((s) => s.addMapping);
  const setSelectedKp = useStore((s) => s.setSelectedKeypoint);
  const bodyNames = useStore((s) => s.bodyNames);
  const acmKeypointNames = useStore((s) => s.acmKeypointNames);
  const mode = useStore((s) => s.mode);

  const [bodySearchText, setBodySearchText] = useState("");
  const [kpSearchText, setKpSearchText] = useState("");
  const bodyListRef = useRef<HTMLDivElement>(null);
  const kpListRef = useRef<HTMLDivElement>(null);

  // Filter body names based on search text
  const filteredBodies = useMemo(() => {
    if (!bodySearchText.trim()) return bodyNames;
    const lower = bodySearchText.toLowerCase();
    return bodyNames.filter((name) => name.toLowerCase().includes(lower));
  }, [bodyNames, bodySearchText]);

  // Filter keypoint names based on search text
  const filteredKeypoints = useMemo(() => {
    if (!kpSearchText.trim()) return acmKeypointNames;
    const lower = kpSearchText.toLowerCase();
    return acmKeypointNames.filter((name) => name.toLowerCase().includes(lower));
  }, [acmKeypointNames, kpSearchText]);

  // Set of already-mapped keypoint names for visual indication
  const mappedKpSet = useMemo(() => new Set(mappings.map((m) => m.keypointName)), [mappings]);

  const handleSelectBody = (bodyName: string) => {
    if (selectedKp) {
      addMapping(selectedKp, bodyName);
      setSelectedKp(null);
      setBodySearchText("");
    }
  };

  const handleSelectKeypoint = (kpName: string) => {
    setSelectedKp(kpName);
    setKpSearchText("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 14, color: "#aaa" }}>{"Keypoint \u2192 Body"}</h3>
      {mode === "mapping" && (
        <div style={{ marginBottom: 8, fontSize: 12, color: "#888" }}>
          {selectedKp ? (
            <span>{"Selected: "}<strong style={{ color: "#ffaa00" }}>{selectedKp}</strong>{" \u2192 click a body or pick below"}</span>
          ) : "Select a keypoint from list or 3D view"}
        </div>
      )}

      {/* Keypoint picker -- always visible in mapping mode */}
      {mode === "mapping" && acmKeypointNames.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 11, color: "#777", marginBottom: 2 }}>Keypoints:</div>
          <input
            type="text"
            placeholder="Filter keypoints..."
            value={kpSearchText}
            onChange={(e) => setKpSearchText(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "#1a1a2e",
              border: "1px solid #555",
              color: "#ccc",
              padding: "4px 8px",
              borderRadius: 4,
              fontSize: 12,
              marginBottom: 2,
            }}
          />
          <div
            ref={kpListRef}
            style={{
              maxHeight: 120,
              overflowY: "auto",
              background: "#1a1a2e",
              border: "1px solid #333",
              borderRadius: 4,
            }}
          >
            {filteredKeypoints.map((name) => (
              <div
                key={name}
                onClick={() => handleSelectKeypoint(name)}
                style={{
                  padding: "3px 8px",
                  fontSize: 12,
                  color: selectedKp === name ? "#ffff00" : mappedKpSet.has(name) ? "#88aa66" : "#ffaa00",
                  cursor: "pointer",
                  borderBottom: "1px solid #222",
                  background: selectedKp === name ? "#2a2a1a" : "transparent",
                }}
                onMouseOver={(e) => { if (selectedKp !== name) e.currentTarget.style.background = "#2a2a3a"; }}
                onMouseOut={(e) => { if (selectedKp !== name) e.currentTarget.style.background = "transparent"; }}
              >
                {name}{mappedKpSet.has(name) ? " *" : ""}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Searchable body name list -- always visible in mapping mode when bodies are loaded */}
      {mode === "mapping" && bodyNames.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 11, color: "#777", marginBottom: 2 }}>Bodies:</div>
          <input
            type="text"
            placeholder="Filter body names..."
            value={bodySearchText}
            onChange={(e) => setBodySearchText(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "#1a1a2e",
              border: "1px solid #555",
              color: "#ccc",
              padding: "4px 8px",
              borderRadius: 4,
              fontSize: 12,
              marginBottom: 2,
            }}
          />
          <div
            ref={bodyListRef}
            style={{
              maxHeight: 120,
              overflowY: "auto",
              background: "#1a1a2e",
              border: "1px solid #333",
              borderRadius: 4,
            }}
          >
            {filteredBodies.length === 0 ? (
              <div style={{ padding: "4px 8px", color: "#555", fontSize: 12 }}>No matches</div>
            ) : (
              filteredBodies.map((name) => (
                <div
                  key={name}
                  onClick={() => handleSelectBody(name)}
                  style={{
                    padding: "3px 8px",
                    fontSize: 12,
                    color: selectedKp ? "#66bbff" : "#445577",
                    cursor: selectedKp ? "pointer" : "default",
                    borderBottom: "1px solid #222",
                    opacity: selectedKp ? 1.0 : 0.5,
                  }}
                  onMouseOver={(e) => { if (selectedKp) e.currentTarget.style.background = "#2a2a4a"; }}
                  onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {name}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        {mappings.length === 0 ? (
          <div style={{ color: "#555", fontSize: 12 }}>No mappings yet</div>
        ) : (
          mappings.map((m) => (
            <div key={m.keypointName} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "4px 4px", borderBottom: "1px solid #2a2a4a", fontSize: 12,
              cursor: "pointer",
              background: selectedKp === m.keypointName ? "#2a2a3a" : "transparent",
            }}
              onClick={() => {
                // Click a mapping row to select that keypoint for reassignment
                setSelectedKp(m.keypointName);
              }}
              title="Click to reassign this mapping"
            >
              <span>
                <span style={{ color: selectedKp === m.keypointName ? "#ffff00" : "#ffaa00" }}>{m.keypointName}</span>{" \u2192 "}
                <span style={{ color: "#66bbff" }}>{m.bodyName}</span>
              </span>
              <button onClick={(e) => { e.stopPropagation(); removeMapping(m.keypointName); }} style={{
                background: "none", border: "none", color: "#ff4444", cursor: "pointer", fontSize: 14,
              }}>x</button>
            </div>
          ))
        )}
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: "#555" }}>{mappings.length} / {acmKeypointNames.length || 21} mapped</div>
    </div>
  );
}
