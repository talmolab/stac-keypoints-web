import React, { useState, useMemo, useRef, useEffect } from "react";
import { useStore } from "../store";

export default function MappingTable() {
  const mappings = useStore((s) => s.mappings);
  const selectedKp = useStore((s) => s.selectedKeypoint);
  const removeMapping = useStore((s) => s.removeMapping);
  const addMapping = useStore((s) => s.addMapping);
  const setSelectedKp = useStore((s) => s.setSelectedKeypoint);
  const bodyNames = useStore((s) => s.bodyNames);
  const mode = useStore((s) => s.mode);

  const [searchText, setSearchText] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter body names based on search text
  const filteredBodies = useMemo(() => {
    if (!searchText.trim()) return bodyNames;
    const lower = searchText.toLowerCase();
    return bodyNames.filter((name) => name.toLowerCase().includes(lower));
  }, [bodyNames, searchText]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.parentElement?.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectBody = (bodyName: string) => {
    if (selectedKp) {
      addMapping(selectedKp, bodyName);
      setSelectedKp(null);
      setSearchText("");
      setShowDropdown(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 14, color: "#aaa" }}>{"Keypoint \u2192 Body"}</h3>
      {mode === "mapping" && (
        <div style={{ marginBottom: 8, fontSize: 12, color: "#888" }}>
          {selectedKp ? (
            <span>{"Selected: "}<strong style={{ color: "#ffaa00" }}>{selectedKp}</strong>{" \u2192 click a body or search below"}</span>
          ) : "Click a keypoint to start mapping"}
        </div>
      )}

      {/* Searchable body name input */}
      {mode === "mapping" && selectedKp && bodyNames.length > 0 && (
        <div style={{ position: "relative", marginBottom: 8 }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search body name..."
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "#1a1a2e",
              border: "1px solid #555",
              color: "#ccc",
              padding: "4px 8px",
              borderRadius: 4,
              fontSize: 12,
            }}
          />
          {showDropdown && (
            <div style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              maxHeight: 200,
              overflowY: "auto",
              background: "#1a1a2e",
              border: "1px solid #555",
              borderRadius: "0 0 4px 4px",
              zIndex: 100,
            }}>
              {filteredBodies.length === 0 ? (
                <div style={{ padding: "4px 8px", color: "#555", fontSize: 12 }}>No matches</div>
              ) : (
                filteredBodies.map((name) => (
                  <div
                    key={name}
                    onClick={() => handleSelectBody(name)}
                    style={{
                      padding: "4px 8px",
                      fontSize: 12,
                      color: "#66bbff",
                      cursor: "pointer",
                      borderBottom: "1px solid #2a2a4a",
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.background = "#2a2a4a")}
                    onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {name}
                  </div>
                ))
              )}
            </div>
          )}
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
                <span style={{ color: "#ffaa00" }}>{m.keypointName}</span>{" \u2192 "}
                <span style={{ color: "#66bbff" }}>{m.bodyName}</span>
              </span>
              <button onClick={() => removeMapping(m.keypointName)} style={{
                background: "none", border: "none", color: "#ff4444", cursor: "pointer", fontSize: 14,
              }}>x</button>
            </div>
          ))
        )}
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: "#555" }}>{mappings.length} / 21 mapped</div>
    </div>
  );
}
